import { describe, it, expect, vi } from "vitest";
import TreeSitter from "web-tree-sitter";
import {
  runQuery,
  resetLoaderForTesting,
} from "../../src/analyzers/tree-sitter.js";

describe("tree-sitter loader", () => {
  it("loads the Java grammar and runs a class-name query", async () => {
    resetLoaderForTesting();
    const source = `package com.example; public class Foo { }`;
    const query = `(class_declaration name: (identifier) @name)`;
    const matches = await runQuery("java", source, query);
    const names = matches.flatMap((m) => m.captures.map((c) => c.node.text));
    expect(names).toContain("Foo");
  });

  it("caches grammars across invocations (only loads each grammar once)", async () => {
    resetLoaderForTesting();
    const spy = vi.spyOn(TreeSitter.Language, "load");
    await runQuery(
      "python",
      `def f(): pass`,
      `(function_definition name: (identifier) @n)`,
    );
    await runQuery(
      "python",
      `def g(): pass`,
      `(function_definition name: (identifier) @n)`,
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
      runQuery("java", `class A {}`, `(class_declaration) @c`),
      runQuery("java", `class B {}`, `(class_declaration) @c`),
      runQuery("java", `class C {}`, `(class_declaration) @c`),
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
