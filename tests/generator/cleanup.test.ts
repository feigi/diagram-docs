import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  isUserModified,
  removeStaleContainerDirs,
  removeStaleSubmoduleComponentDirs,
} from "../../src/generator/d2/cleanup.js";
import { configSchema } from "../../src/config/schema.js";
import type { ArchitectureModel } from "../../src/analyzers/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "diagram-docs-cleanup-"));
}

function makeModel(containerIds: string[]): ArchitectureModel {
  return {
    version: 1,
    system: { name: "Test System", description: "Test" },
    actors: [],
    externalSystems: [],
    containers: containerIds.map((id) => ({
      id,
      applicationId: id,
      name: id,
      description: id,
      technology: "TypeScript",
    })),
    components: [],
    relationships: [],
  };
}

const MARKER = "# Add your customizations below this line";
const DEFAULT_SCAFFOLD = `# C4 Component Diagram — Test\n\n...@_generated/c3-component.d2\n...@../../styles.d2\n\n${MARKER}\n`;
const CUSTOMIZED_SCAFFOLD = `${DEFAULT_SCAFFOLD}\nsome user content here\n`;

// ---------------------------------------------------------------------------
// isUserModified
// ---------------------------------------------------------------------------

describe("isUserModified", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns false when file does not exist", () => {
    const filePath = path.join(tmpDir, "nonexistent.d2");
    expect(isUserModified(filePath)).toBe(false);
  });

  it("returns false when file has no content after the marker", () => {
    const filePath = path.join(tmpDir, "scaffold.d2");
    fs.writeFileSync(filePath, DEFAULT_SCAFFOLD, "utf-8");
    expect(isUserModified(filePath)).toBe(false);
  });

  it("returns false when file has only whitespace after the marker", () => {
    const filePath = path.join(tmpDir, "scaffold.d2");
    fs.writeFileSync(filePath, `${DEFAULT_SCAFFOLD}\n   \n\t\n`, "utf-8");
    expect(isUserModified(filePath)).toBe(false);
  });

  it("returns true when file has non-empty content after the marker", () => {
    const filePath = path.join(tmpDir, "scaffold.d2");
    fs.writeFileSync(filePath, CUSTOMIZED_SCAFFOLD, "utf-8");
    expect(isUserModified(filePath)).toBe(true);
  });

  it("returns true when file has no marker at all (structure modified)", () => {
    const filePath = path.join(tmpDir, "scaffold.d2");
    fs.writeFileSync(filePath, "completely different content", "utf-8");
    expect(isUserModified(filePath)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// removeStaleContainerDirs
// ---------------------------------------------------------------------------

describe("removeStaleContainerDirs", () => {
  let tmpDir: string;
  let outputDir: string;
  let containersDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    outputDir = tmpDir;
    containersDir = path.join(outputDir, "containers");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  // ── T015: containers/ absent ────────────────────────────────────────────

  it("returns without error when containers/ directory does not exist", () => {
    const model = makeModel(["svc-a"]);
    expect(() => removeStaleContainerDirs(outputDir, model)).not.toThrow();
  });

  // ── T004: all containers active → no-op ────────────────────────────────

  it("does not remove directories for active containers", () => {
    fs.mkdirSync(path.join(containersDir, "svc-a"), { recursive: true });
    fs.mkdirSync(path.join(containersDir, "svc-a", "_generated"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(containersDir, "svc-a", "c3-component.d2"),
      DEFAULT_SCAFFOLD,
    );

    const model = makeModel(["svc-a"]);
    removeStaleContainerDirs(outputDir, model);

    expect(
      fs.existsSync(path.join(containersDir, "svc-a", "c3-component.d2")),
    ).toBe(true);
  });

  // ── T004: orphaned + unmodified scaffold → dir removed ─────────────────

  it("removes orphaned directory with unmodified scaffold file", () => {
    const staleDir = path.join(containersDir, "old-svc");
    fs.mkdirSync(path.join(staleDir, "_generated"), { recursive: true });
    fs.writeFileSync(path.join(staleDir, "c3-component.d2"), DEFAULT_SCAFFOLD);

    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const model = makeModel(["svc-a"]);
    removeStaleContainerDirs(outputDir, model);

    expect(fs.existsSync(staleDir)).toBe(false);
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining("Removed: containers/old-svc/"),
    );
  });

  // ── T004: orphaned + modified scaffold → dir kept + warning ────────────

  it("preserves orphaned directory when scaffold has user customizations", () => {
    const staleDir = path.join(containersDir, "old-svc");
    fs.mkdirSync(path.join(staleDir, "_generated"), { recursive: true });
    const scaffoldPath = path.join(staleDir, "c3-component.d2");
    fs.writeFileSync(scaffoldPath, CUSTOMIZED_SCAFFOLD);

    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const model = makeModel(["svc-a"]);
    removeStaleContainerDirs(outputDir, model);

    expect(fs.existsSync(scaffoldPath)).toBe(true);
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining("has user customizations"),
    );
  });

  // ── T012/T013: _generated/ always removed ──────────────────────────────

  it("always removes _generated/ for orphaned containers", () => {
    const staleDir = path.join(containersDir, "old-svc");
    const generatedDir = path.join(staleDir, "_generated");
    fs.mkdirSync(generatedDir, { recursive: true });
    fs.writeFileSync(
      path.join(generatedDir, "c3-component.d2"),
      "generated content",
    );
    // Modified scaffold — so parent dir will be kept
    fs.writeFileSync(
      path.join(staleDir, "c3-component.d2"),
      CUSTOMIZED_SCAFFOLD,
    );

    vi.spyOn(console, "error").mockImplementation(() => {});
    const model = makeModel(["svc-a"]);
    removeStaleContainerDirs(outputDir, model);

    expect(fs.existsSync(generatedDir)).toBe(false);
    expect(fs.existsSync(staleDir)).toBe(true); // parent kept (customized)
  });

  // ── T016: orphaned dir with only _generated/ (no scaffold file) ─────────

  it("removes orphaned directory that has only _generated/ and no scaffold file", () => {
    const staleDir = path.join(containersDir, "old-svc");
    const generatedDir = path.join(staleDir, "_generated");
    fs.mkdirSync(generatedDir, { recursive: true });
    fs.writeFileSync(
      path.join(generatedDir, "c3-component.d2"),
      "generated content",
    );
    // No scaffold file created

    vi.spyOn(console, "error").mockImplementation(() => {});
    const model = makeModel(["svc-a"]);
    removeStaleContainerDirs(outputDir, model);

    expect(fs.existsSync(generatedDir)).toBe(false);
    expect(fs.existsSync(staleDir)).toBe(false);
  });

  // ── T012: _generated/ removed even when scaffold is kept ───────────────

  it("removes _generated/ for orphaned container with unmodified scaffold and removes parent", () => {
    const staleDir = path.join(containersDir, "old-svc");
    const generatedDir = path.join(staleDir, "_generated");
    fs.mkdirSync(generatedDir, { recursive: true });
    fs.writeFileSync(
      path.join(generatedDir, "c3-component.d2"),
      "generated content",
    );
    fs.writeFileSync(path.join(staleDir, "c3-component.d2"), DEFAULT_SCAFFOLD);

    vi.spyOn(console, "error").mockImplementation(() => {});
    const model = makeModel(["svc-a"]);
    removeStaleContainerDirs(outputDir, model);

    expect(fs.existsSync(generatedDir)).toBe(false);
    expect(fs.existsSync(staleDir)).toBe(false);
  });

  // ── T004: orphaned dir with no scaffold file, only _generated/ ─────────

  it("does not remove active containers when mix of active and stale exists", () => {
    // Active
    fs.mkdirSync(path.join(containersDir, "svc-a"), { recursive: true });
    fs.writeFileSync(
      path.join(containersDir, "svc-a", "c3-component.d2"),
      DEFAULT_SCAFFOLD,
    );
    // Stale
    const staleDir = path.join(containersDir, "old-svc");
    fs.mkdirSync(staleDir, { recursive: true });
    fs.writeFileSync(path.join(staleDir, "c3-component.d2"), DEFAULT_SCAFFOLD);

    vi.spyOn(console, "error").mockImplementation(() => {});
    const model = makeModel(["svc-a"]);
    removeStaleContainerDirs(outputDir, model);

    expect(
      fs.existsSync(path.join(containersDir, "svc-a", "c3-component.d2")),
    ).toBe(true);
    expect(fs.existsSync(staleDir)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// removeStaleSubmoduleComponentDirs
// ---------------------------------------------------------------------------

const SUBMODULE_MARKER = "# Add your customizations below this line";

function setupSubmoduleStale(opts: { userModified: boolean }) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cleanup-submodule-"));
  const repoRoot = path.join(tmp, "repo");
  const archDir = path.join(repoRoot, "services/foo/docs/architecture");
  const compDir = path.join(archDir, "components", "stale-comp");
  fs.mkdirSync(path.join(compDir, "_generated"), { recursive: true });
  fs.writeFileSync(
    path.join(compDir, "_generated/c4-code.d2"),
    "auto",
    "utf-8",
  );
  fs.writeFileSync(
    path.join(compDir, "c4-code.d2"),
    opts.userModified
      ? `${SUBMODULE_MARKER}\nstale_id.style.fill: red\n`
      : `${SUBMODULE_MARKER}\n`,
    "utf-8",
  );
  return { tmp, repoRoot, archDir, compDir };
}

const submoduleBaseModel: ArchitectureModel = {
  version: 1,
  system: { name: "Sys", description: "" },
  actors: [],
  externalSystems: [],
  containers: [
    {
      id: "c",
      name: "C",
      technology: "TS",
      description: "",
      applicationId: "foo",
      path: "services/foo",
    },
  ],
  components: [
    // Note: NO "stale-comp" — its dir on disk is orphaned.
    {
      id: "live-comp",
      name: "Live",
      containerId: "c",
      technology: "TS",
      description: "",
      moduleIds: [],
    },
  ],
  relationships: [],
};

describe("removeStaleSubmoduleComponentDirs", () => {
  it("removes orphaned component dir when scaffold has no user content", () => {
    const { tmp, repoRoot, compDir } = setupSubmoduleStale({
      userModified: false,
    });
    try {
      const config = configSchema.parse({ submodules: { enabled: true } });
      removeStaleSubmoduleComponentDirs(repoRoot, config, submoduleBaseModel);
      expect(fs.existsSync(compDir)).toBe(false);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("preserves orphaned component dir when scaffold has user customizations", () => {
    const { tmp, repoRoot, compDir } = setupSubmoduleStale({
      userModified: true,
    });
    try {
      const config = configSchema.parse({ submodules: { enabled: true } });
      const errors: string[] = [];
      const origErr = console.error;
      console.error = (msg: string) => errors.push(msg);
      try {
        removeStaleSubmoduleComponentDirs(repoRoot, config, submoduleBaseModel);
      } finally {
        console.error = origErr;
      }
      expect(fs.existsSync(compDir)).toBe(true);
      expect(errors.some((e) => e.includes("user customizations"))).toBe(true);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("leaves active component dirs untouched", () => {
    const { tmp, repoRoot, archDir } = setupSubmoduleStale({
      userModified: false,
    });
    try {
      const liveDir = path.join(archDir, "components", "live-comp");
      fs.mkdirSync(path.join(liveDir, "_generated"), { recursive: true });
      fs.writeFileSync(
        path.join(liveDir, "_generated/c4-code.d2"),
        "auto",
        "utf-8",
      );
      fs.writeFileSync(
        path.join(liveDir, "c4-code.d2"),
        SUBMODULE_MARKER,
        "utf-8",
      );

      const config = configSchema.parse({ submodules: { enabled: true } });
      removeStaleSubmoduleComponentDirs(repoRoot, config, submoduleBaseModel);

      expect(fs.existsSync(liveDir)).toBe(true);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
