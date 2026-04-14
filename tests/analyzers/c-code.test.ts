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
});
