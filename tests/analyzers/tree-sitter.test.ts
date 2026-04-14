import { describe, it, expect } from "vitest";
import {
  loadLanguage,
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

  it("caches grammars across invocations", async () => {
    resetLoaderForTesting();
    const src = `def f(): pass`;
    await runQuery(
      "python",
      src,
      `(function_definition name: (identifier) @n)`,
    );
    const matches = await runQuery(
      "python",
      src,
      `(function_definition name: (identifier) @n)`,
    );
    expect(matches.length).toBe(1);
  });
});
