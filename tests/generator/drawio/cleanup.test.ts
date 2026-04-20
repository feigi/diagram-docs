import { describe, it, expect, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  removeStaleDrawioFiles,
  removeStaleSubmoduleDrawioFiles,
} from "../../../src/generator/drawio/cleanup.js";
import type { ArchitectureModel } from "../../../src/analyzers/types.js";
import { configSchema } from "../../../src/config/schema.js";

const DRAWIO_FIXTURES = path.resolve(__dirname, "../../fixtures/drawio");

const emptyModel: ArchitectureModel = {
  version: 1,
  system: { name: "S", description: "" },
  actors: [],
  externalSystems: [],
  containers: [],
  components: [],
  relationships: [],
};

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ddocs-dw-clean-"));
}

function writeManaged(filePath: string, id = "mgr"): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(
    filePath,
    `<?xml version="1.0"?>
<mxfile><diagram><mxGraphModel><root>
  <mxCell id="0"/><mxCell id="1" parent="0"/>
  <mxCell id="${id}" style="ddocs_managed=1" vertex="1" parent="1">
    <mxGeometry x="0" y="0" width="10" height="10" as="geometry"/>
  </mxCell>
</root></mxGraphModel></diagram></mxfile>`,
  );
}

function writeUnmanaged(filePath: string, id = "note"): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(
    filePath,
    `<?xml version="1.0"?>
<mxfile><diagram><mxGraphModel><root>
  <mxCell id="0"/><mxCell id="1" parent="0"/>
  <mxCell id="${id}" style="fillColor=#fff2cc" vertex="1" parent="1">
    <mxGeometry x="0" y="0" width="10" height="10" as="geometry"/>
  </mxCell>
</root></mxGraphModel></diagram></mxfile>`,
  );
}

describe("removeStaleDrawioFiles", () => {
  it("removes container .drawio files when the container is gone", () => {
    const dir = tmp();
    const stale = path.join(dir, "containers", "gone.drawio");
    fs.mkdirSync(path.dirname(stale), { recursive: true });
    fs.writeFileSync(
      stale,
      `<?xml version="1.0"?>
<mxfile><diagram><mxGraphModel><root>
  <mxCell id="0"/><mxCell id="1" parent="0"/>
  <mxCell id="gone" style="ddocs_managed=1" vertex="1" parent="1">
    <mxGeometry x="0" y="0" width="10" height="10" as="geometry"/>
  </mxCell>
</root></mxGraphModel></diagram></mxfile>`,
    );
    removeStaleDrawioFiles(dir, emptyModel);
    expect(fs.existsSync(stale)).toBe(false);
  });

  it("preserves file when it contains any unmanaged cell", () => {
    const dir = tmp();
    const preserved = path.join(dir, "containers", "gone.drawio");
    fs.mkdirSync(path.dirname(preserved), { recursive: true });
    fs.writeFileSync(
      preserved,
      `<?xml version="1.0"?>
<mxfile><diagram><mxGraphModel><root>
  <mxCell id="0"/><mxCell id="1" parent="0"/>
  <mxCell id="note" style="fillColor=#fff2cc" vertex="1" parent="1">
    <mxGeometry x="0" y="0" width="10" height="10" as="geometry"/>
  </mxCell>
</root></mxGraphModel></diagram></mxfile>`,
    );
    removeStaleDrawioFiles(dir, emptyModel);
    expect(fs.existsSync(preserved)).toBe(true);
  });

  it("logs a warning and preserves a corrupt .drawio file", () => {
    const dir = tmp();
    const target = path.join(dir, "containers", "gone.drawio");
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(DRAWIO_FIXTURES, "corrupted.drawio"), target);

    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(() => removeStaleDrawioFiles(dir, emptyModel)).not.toThrow();
      expect(fs.existsSync(target)).toBe(true);
      const messages = spy.mock.calls.map((c) => String(c[0]));
      expect(messages.some((m) => m.includes("could not be parsed"))).toBe(
        true,
      );
    } finally {
      spy.mockRestore();
    }
  });
});

describe("removeStaleSubmoduleDrawioFiles", () => {
  it("removes c4-code.drawio for a component no longer in the container", () => {
    const repo = tmp();
    const model: ArchitectureModel = {
      version: 1,
      system: { name: "S", description: "" },
      actors: [],
      externalSystems: [],
      containers: [
        {
          id: "auth",
          applicationId: "auth",
          name: "Auth",
          description: "",
          technology: "",
          path: "services/auth",
        },
      ],
      components: [
        {
          id: "handler",
          containerId: "auth",
          name: "Handler",
          description: "",
          technology: "",
          moduleIds: [],
        },
      ],
      relationships: [],
    };
    const cfg = configSchema.parse({
      output: { generators: ["drawio"] },
      submodules: { enabled: true, docsDir: "docs" },
    });

    const archDir = path.join(repo, "services/auth/docs/architecture");
    // Component still present — must be preserved.
    const keep = path.join(archDir, "components", "handler", "c4-code.drawio");
    writeManaged(keep, "handler");
    // Component deleted from model — must be removed.
    const stale = path.join(archDir, "components", "gone", "c4-code.drawio");
    writeManaged(stale, "gone");
    // Container is still in model — its c3 must be preserved.
    const containerFile = path.join(archDir, "c3-component.drawio");
    writeManaged(containerFile, "auth");

    removeStaleSubmoduleDrawioFiles(repo, model, cfg);

    expect(fs.existsSync(stale)).toBe(false);
    expect(fs.existsSync(keep)).toBe(true);
    expect(fs.existsSync(containerFile)).toBe(true);
  });

  it("preserves a stale submodule file that contains user-authored cells", () => {
    const repo = tmp();
    const model: ArchitectureModel = {
      version: 1,
      system: { name: "S", description: "" },
      actors: [],
      externalSystems: [],
      containers: [
        {
          id: "auth",
          applicationId: "auth",
          name: "Auth",
          description: "",
          technology: "",
          path: "services/auth",
        },
      ],
      components: [],
      relationships: [],
    };
    const cfg = configSchema.parse({
      output: { generators: ["drawio"] },
      submodules: { enabled: true, docsDir: "docs" },
    });

    const archDir = path.join(repo, "services/auth/docs/architecture");
    const staleWithUser = path.join(
      archDir,
      "components",
      "gone",
      "c4-code.drawio",
    );
    writeUnmanaged(staleWithUser, "free-drawn");

    removeStaleSubmoduleDrawioFiles(repo, model, cfg);

    expect(fs.existsSync(staleWithUser)).toBe(true);
  });

  it("is a no-op when submodules are not enabled", () => {
    const repo = tmp();
    const model: ArchitectureModel = {
      version: 1,
      system: { name: "S", description: "" },
      actors: [],
      externalSystems: [],
      containers: [
        {
          id: "auth",
          applicationId: "auth",
          name: "Auth",
          description: "",
          technology: "",
          path: "services/auth",
        },
      ],
      components: [],
      relationships: [],
    };
    const cfg = configSchema.parse({
      output: { generators: ["drawio"] },
      submodules: { enabled: false, docsDir: "docs" },
    });

    const archDir = path.join(repo, "services/auth/docs/architecture");
    const stale = path.join(archDir, "components", "gone", "c4-code.drawio");
    writeManaged(stale, "gone");

    removeStaleSubmoduleDrawioFiles(repo, model, cfg);

    // Submodules disabled — nothing touched.
    expect(fs.existsSync(stale)).toBe(true);
  });

  it("removes c3-component.drawio when its container became an aggregator", () => {
    const repo = tmp();
    // parent is aggregator (ancestor path of child).
    const model: ArchitectureModel = {
      version: 1,
      system: { name: "S", description: "" },
      actors: [],
      externalSystems: [],
      containers: [
        {
          id: "parent",
          applicationId: "parent",
          name: "Parent",
          description: "",
          technology: "",
          path: "apps/parent",
        },
        {
          id: "child",
          applicationId: "child",
          name: "Child",
          description: "",
          technology: "",
          path: "apps/parent/child",
        },
      ],
      components: [],
      relationships: [],
    };
    const cfg = configSchema.parse({
      output: { generators: ["drawio"] },
      submodules: { enabled: true, docsDir: "docs" },
    });

    const aggregatorFile = path.join(
      repo,
      "apps/parent/docs/architecture/c3-component.drawio",
    );
    writeManaged(aggregatorFile, "parent");

    removeStaleSubmoduleDrawioFiles(repo, model, cfg);

    expect(fs.existsSync(aggregatorFile)).toBe(false);
  });

  it("sweeps stale components while leaving multiple live siblings intact", () => {
    const repo = tmp();
    const model: ArchitectureModel = {
      version: 1,
      system: { name: "S", description: "" },
      actors: [],
      externalSystems: [],
      containers: [
        {
          id: "api",
          applicationId: "api",
          name: "API",
          description: "",
          technology: "",
          path: "services/api",
        },
      ],
      components: [
        {
          id: "router",
          containerId: "api",
          name: "Router",
          description: "",
          technology: "",
          moduleIds: [],
        },
        {
          id: "service",
          containerId: "api",
          name: "Service",
          description: "",
          technology: "",
          moduleIds: [],
        },
      ],
      relationships: [],
    };
    const cfg = configSchema.parse({
      output: { generators: ["drawio"] },
      submodules: { enabled: true, docsDir: "docs" },
    });

    const archDir = path.join(repo, "services/api/docs/architecture");
    const liveA = path.join(archDir, "components", "router", "c4-code.drawio");
    const liveB = path.join(archDir, "components", "service", "c4-code.drawio");
    const stale = path.join(archDir, "components", "legacy", "c4-code.drawio");
    writeManaged(liveA, "router");
    writeManaged(liveB, "service");
    writeManaged(stale, "legacy");

    removeStaleSubmoduleDrawioFiles(repo, model, cfg);

    expect(fs.existsSync(stale)).toBe(false);
    expect(fs.existsSync(liveA)).toBe(true);
    expect(fs.existsSync(liveB)).toBe(true);
  });
});
