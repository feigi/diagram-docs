import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { extractCCode } from "../../src/analyzers/c/code.js";

const H = path.resolve(__dirname, "../fixtures/code-level/c/hash_table.h");
const C = path.resolve(__dirname, "../fixtures/code-level/c/hash_table.c");

describe("c code extraction", () => {
  it("extracts structs, typedefs, and functions from a header", async () => {
    const els = await extractCCode(H, fs.readFileSync(H, "utf-8"));
    const names = els.map((e) => e.name).sort();
    expect(names).toEqual(
      expect.arrayContaining([
        "hash_entry",
        "hash_table",
        "hash_create",
        "hash_destroy",
        "hash_insert",
        "hash_lookup",
      ]),
    );
  });

  it("marks static functions as private", async () => {
    const els = await extractCCode(C, fs.readFileSync(C, "utf-8"));
    const rehash = els.find((e) => e.name === "rehash")!;
    expect(rehash.visibility).toBe("private");
  });

  it("marks extern (non-static) functions as public", async () => {
    const els = await extractCCode(C, fs.readFileSync(C, "utf-8"));
    const insert = els.find((e) => e.name === "hash_insert")!;
    expect(insert.visibility).toBe("public");
  });

  it("records struct fields as members", async () => {
    const els = await extractCCode(H, fs.readFileSync(H, "utf-8"));
    const table = els.find(
      (e) => e.name === "hash_table" && e.kind === "struct",
    )!;
    const fieldNames = (table.members ?? []).map((m) => m.name).sort();
    expect(fieldNames).toEqual(["capacity", "count", "entries"]);
  });

  it("emits 'contains' references for struct fields typed as another struct/typedef", async () => {
    const els = await extractCCode(H, fs.readFileSync(H, "utf-8"));
    const table = els.find(
      (e) => e.name === "hash_table" && e.kind === "struct",
    )!;
    const containsTargets = (table.references ?? [])
      .filter((r) => r.kind === "contains")
      .map((r) => r.targetName);
    expect(containsTargets).toContain("hash_entry_t");

    const entry = els.find(
      (e) => e.name === "hash_entry" && e.kind === "struct",
    )!;
    const entryTargets = (entry.references ?? [])
      .filter((r) => r.kind === "contains")
      .map((r) => r.targetName);
    expect(entryTargets).toContain("hash_entry_t");
  });

  it("emits 'uses' references for function parameter and return types", async () => {
    const els = await extractCCode(H, fs.readFileSync(H, "utf-8"));
    const insert = els.find((e) => e.name === "hash_insert")!;
    const usesTargets = (insert.references ?? [])
      .filter((r) => r.kind === "uses")
      .map((r) => r.targetName);
    expect(usesTargets).toContain("hash_table_t");
  });

  it("suppresses primitive/stdlib types from references", async () => {
    const els = await extractCCode(H, fs.readFileSync(H, "utf-8"));
    const insert = els.find((e) => e.name === "hash_insert")!;
    const targets = (insert.references ?? []).map((r) => r.targetName);
    expect(targets).not.toContain("void");
    expect(targets).not.toContain("char");
    expect(targets).not.toContain("size_t");
  });

  it("handles multi-level pointer returns (T **fn)", async () => {
    const src = `
      struct handle;
      struct handle **get_handle(int x);
      struct handle ***get_handle_triple(int x);
    `;
    const els = await extractCCode("inline.c", src);
    const names = els.map((e) => e.name);
    expect(names).toContain("get_handle");
    expect(names).toContain("get_handle_triple");
  });

  it("extracts struct field names for arrays and function-pointer fields", async () => {
    const src = `
      struct widget {
        int arr[10];
        int (*cb)(int);
        char *name;
      };
    `;
    const els = await extractCCode("inline.c", src);
    const widget = els.find((e) => e.name === "widget" && e.kind === "struct")!;
    const names = (widget.members ?? []).map((m) => m.name).sort();
    expect(names).toEqual(["arr", "cb", "name"]);
  });

  it("returns gracefully on malformed source", async () => {
    const broken = `struct Broken { int a;\nvoid oops( {`;
    const elements = await extractCCode("/tmp/broken.c", broken);
    expect(Array.isArray(elements)).toBe(true);
  });
});
