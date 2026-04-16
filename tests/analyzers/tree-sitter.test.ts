import { describe, it, expect, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import TreeSitter from "web-tree-sitter";
import {
  runQueryScoped,
  resetLoaderForTesting,
  extractCodeElementsForFiles,
} from "../../src/analyzers/tree-sitter.js";
import type { RawCodeElement } from "../../src/analyzers/types.js";

describe("tree-sitter loader", () => {
  it("loads the Java grammar and runs a class-name query", async () => {
    resetLoaderForTesting();
    const source = `package com.example; public class Foo { }`;
    const query = `(class_declaration name: (identifier) @name)`;
    const names = await runQueryScoped("java", source, query, (matches) =>
      matches.flatMap((m) => m.captures.map((c) => c.node.text)),
    );
    expect(names).toContain("Foo");
  });

  it("caches grammars across invocations (only loads each grammar once)", async () => {
    resetLoaderForTesting();
    const spy = vi.spyOn(TreeSitter.Language, "load");
    await runQueryScoped(
      "python",
      `def f(): pass`,
      `(function_definition name: (identifier) @n)`,
      () => undefined,
    );
    await runQueryScoped(
      "python",
      `def g(): pass`,
      `(function_definition name: (identifier) @n)`,
      () => undefined,
    );
    const pythonLoadCalls = spy.mock.calls.filter(
      (args) =>
        typeof args[0] === "string" &&
        args[0].includes("tree-sitter-python.wasm"),
    );
    expect(pythonLoadCalls.length).toBe(1);
    spy.mockRestore();
  });

  it("deduplicates concurrent loads of the same grammar", async () => {
    resetLoaderForTesting();
    const spy = vi.spyOn(TreeSitter.Language, "load");
    await Promise.all([
      runQueryScoped(
        "java",
        `class A {}`,
        `(class_declaration) @c`,
        () => undefined,
      ),
      runQueryScoped(
        "java",
        `class B {}`,
        `(class_declaration) @c`,
        () => undefined,
      ),
      runQueryScoped(
        "java",
        `class C {}`,
        `(class_declaration) @c`,
        () => undefined,
      ),
    ]);
    const javaLoadCalls = spy.mock.calls.filter(
      (args) =>
        typeof args[0] === "string" &&
        args[0].includes("tree-sitter-java.wasm"),
    );
    expect(javaLoadCalls.length).toBe(1);
    spy.mockRestore();
  });
});

describe("extractCodeElementsForFiles isolation", () => {
  it("isolates per-file failures and continues processing other files", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ts-extract-"));
    const goodFile = path.join(tmp, "good.txt");
    fs.writeFileSync(goodFile, "ok");
    const missingFile = path.join(tmp, "missing.txt");

    const stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);

    const results = await extractCodeElementsForFiles(
      [goodFile, missingFile],
      async (fp): Promise<RawCodeElement[]> => [
        {
          id: fp,
          kind: "function",
          name: path.basename(fp),
          location: { file: fp, line: 1 },
        },
      ],
    );

    expect(results.length).toBe(1);
    expect(results[0].name).toBe("good.txt");
    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining("code-level extraction failed"),
    );
    stderrSpy.mockRestore();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("emits a systemic-failure warning when every extractor throws", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ts-extract-"));
    const a = path.join(tmp, "a.txt");
    const b = path.join(tmp, "b.txt");
    fs.writeFileSync(a, "a");
    fs.writeFileSync(b, "b");
    const stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);

    await extractCodeElementsForFiles([a, b], async () => {
      throw new Error("walker bug");
    });

    const messages = stderrSpy.mock.calls
      .map((args) => String(args[0]))
      .join("\n");
    expect(messages).toMatch(/failed on all 2 file/);
    stderrSpy.mockRestore();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("emits a partial-failure summary when some extractors throw", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ts-extract-"));
    const a = path.join(tmp, "a.txt");
    const b = path.join(tmp, "b.txt");
    const c = path.join(tmp, "c.txt");
    fs.writeFileSync(a, "a");
    fs.writeFileSync(b, "b");
    fs.writeFileSync(c, "c");
    const stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);

    await extractCodeElementsForFiles([a, b, c], async (fp) => {
      if (fp === a) throw new Error("bug");
      return [];
    });

    const messages = stderrSpy.mock.calls
      .map((args) => String(args[0]))
      .join("\n");
    expect(messages).toMatch(/failed for 1\/3 file/);
    stderrSpy.mockRestore();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("isolates extractor throws and continues", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ts-extract-"));
    const a = path.join(tmp, "a.txt");
    const b = path.join(tmp, "b.txt");
    fs.writeFileSync(a, "a");
    fs.writeFileSync(b, "b");

    const stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);

    const results = await extractCodeElementsForFiles([a, b], async (fp) => {
      if (fp === a) throw new Error("boom");
      return [
        {
          id: fp,
          kind: "function",
          name: "ok",
          location: { file: fp, line: 1 },
        },
      ];
    });

    expect(results.length).toBe(1);
    expect(results[0].name).toBe("ok");
    stderrSpy.mockRestore();
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
