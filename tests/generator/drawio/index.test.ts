import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { generateDrawioFile } from "../../../src/generator/drawio/index.js";
import { STYLES } from "../../../src/generator/drawio/styles.js";

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ddocs-drawio-"));
}

describe("generateDrawioFile", () => {
  it("writes a .drawio file with the fresh cells", async () => {
    const dir = tmp();
    const out = path.join(dir, "c1-context.drawio");
    await generateDrawioFile({
      filePath: out,
      diagramName: "L1",
      level: "context",
      cells: {
        vertices: [
          {
            id: "a",
            value: "A",
            style: STYLES.container,
            kind: "container" as const,
          },
        ],
        edges: [],
      },
    });
    const xml = fs.readFileSync(out, "utf-8");
    expect(xml).toContain('id="a"');
    expect(xml).toContain("mxGraphModel");
  });

  it("is byte-identical across two runs with unchanged input", async () => {
    const dir = tmp();
    const out = path.join(dir, "c1-context.drawio");
    const cells = {
      vertices: [
        {
          id: "a",
          value: "A",
          style: STYLES.container,
          kind: "container" as const,
        },
        {
          id: "b",
          value: "B",
          style: STYLES.container,
          kind: "container" as const,
        },
      ],
      edges: [
        {
          id: "a->b-uses",
          source: "a",
          target: "b",
          value: "uses",
          style: STYLES.relationship,
        },
      ],
    };
    await generateDrawioFile({
      filePath: out,
      diagramName: "L1",
      level: "context",
      cells,
    });
    const first = fs.readFileSync(out, "utf-8");
    await generateDrawioFile({
      filePath: out,
      diagramName: "L1",
      level: "context",
      cells,
    });
    const second = fs.readFileSync(out, "utf-8");
    expect(second).toBe(first);
  });

  it("aborts and leaves the file intact on corrupt existing XML", async () => {
    const dir = tmp();
    const out = path.join(dir, "c1-context.drawio");
    const corrupt = "<not xml";
    fs.writeFileSync(out, corrupt, "utf-8");
    await expect(
      generateDrawioFile({
        filePath: out,
        diagramName: "L1",
        level: "context",
        cells: { vertices: [], edges: [] },
      }),
    ).rejects.toThrow();
    expect(fs.readFileSync(out, "utf-8")).toBe(corrupt);
  });

  it("writes atomically and leaves no .tmp file behind", async () => {
    const dir = tmp();
    const out = path.join(dir, "c1-context.drawio");
    await generateDrawioFile({
      filePath: out,
      diagramName: "L1",
      level: "context",
      cells: {
        vertices: [
          {
            id: "a",
            value: "A",
            style: STYLES.container,
            kind: "container" as const,
          },
        ],
        edges: [],
      },
    });
    expect(fs.existsSync(out)).toBe(true);
    expect(fs.existsSync(`${out}.tmp`)).toBe(false);
  });

  it("sizes person vertex at 48x80 via nodeSize(kind)", async () => {
    const dir = tmp();
    const filePath = path.join(dir, "size-test.drawio");
    await generateDrawioFile({
      filePath,
      diagramName: "L1",
      level: "context",
      cells: {
        vertices: [
          {
            id: "user",
            value: "User\n[Person]",
            style: STYLES.person,
            kind: "person",
          },
          {
            id: "svc",
            value: "Svc\n[Container: Go]",
            style: STYLES.container,
            kind: "container",
          },
        ],
        edges: [
          {
            id: "user->svc-uses",
            source: "user",
            target: "svc",
            value: "uses",
            style: STYLES.relationship,
          },
        ],
      },
    });
    const xml = fs.readFileSync(filePath, "utf-8");
    expect(xml).toMatch(/id="user"[\s\S]*?width="48"[^>]*height="80"/);
    expect(xml).toMatch(/id="svc"[\s\S]*?width="180"[^>]*height="70"/);
  });

  it("propagates vertex and edge tooltips through to the serialised XML", async () => {
    const tmpDir = tmp();
    const filePath = path.join(tmpDir, "tooltip-flow.drawio");
    await generateDrawioFile({
      filePath,
      diagramName: "L2",
      level: "container",
      cells: {
        vertices: [
          {
            id: "svc",
            value: "Svc\n[Container: Go]",
            tooltip: "HTTP API over Postgres",
            style: STYLES.container,
            kind: "container",
          },
          {
            id: "db",
            value: "DB\n[Container: Postgres]",
            tooltip: "Primary relational store",
            style: STYLES.container,
            kind: "container",
          },
        ],
        edges: [
          {
            id: "svc->db-reads",
            source: "svc",
            target: "db",
            value: "reads",
            tooltip: "[JDBC]",
            style: STYLES.relationship,
          },
        ],
      },
    });
    const xml = fs.readFileSync(filePath, "utf-8");
    expect(xml).toContain('tooltip="HTTP API over Postgres"');
    expect(xml).toContain('tooltip="Primary relational store"');
    expect(xml).toContain('tooltip="[JDBC]"');
    expect(xml).toMatch(/<UserObject[^>]*id="svc-&gt;db-reads"/);
  });

  it("does not truncate an existing file when the write fails", async () => {
    const dir = tmp();
    const out = path.join(dir, "c1-context.drawio");
    // Seed with a valid (empty) drawio file so the merge step succeeds.
    await generateDrawioFile({
      filePath: out,
      diagramName: "L1",
      level: "context",
      cells: { vertices: [], edges: [] },
    });
    const original = fs.readFileSync(out, "utf-8");

    // Pre-create a directory at the tmp path to force writeFileSync to fail
    // with EISDIR, simulating a mid-write failure without mocking fs.
    const tmpPath = `${out}.tmp`;
    fs.mkdirSync(tmpPath);

    await expect(
      generateDrawioFile({
        filePath: out,
        diagramName: "L1",
        level: "context",
        cells: {
          vertices: [
            {
              id: "a",
              value: "A",
              style: STYLES.container,
              kind: "container" as const,
            },
          ],
          edges: [],
        },
      }),
    ).rejects.toThrow();

    // Original file is untouched.
    expect(fs.readFileSync(out, "utf-8")).toBe(original);
    // The directory we pre-created survives (it's not a regular file we
    // expect cleanup to remove — rmSync with force handles that case too).
    // What matters: the destination was not replaced.
  });
});
