import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  isUserModified,
  isInertSubmoduleStub,
  removeStaleContainerDirs,
  removeStaleSubmoduleDirs,
} from "../../src/generator/d2/cleanup.js";
import type { ArchitectureModel } from "../../src/analyzers/types.js";
import { configSchema } from "../../src/config/schema.js";

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
// isInertSubmoduleStub
// ---------------------------------------------------------------------------

describe("isInertSubmoduleStub", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns true when every non-empty line is a comment", () => {
    const filePath = path.join(tmpDir, "diagram-docs.yaml");
    fs.writeFileSync(
      filePath,
      "# diagram-docs.yaml for Foo\n#\n# system:\n#   name: Foo\n",
    );
    expect(isInertSubmoduleStub(filePath)).toBe(true);
  });

  it("returns false when any non-comment, non-empty line exists", () => {
    const filePath = path.join(tmpDir, "diagram-docs.yaml");
    fs.writeFileSync(filePath, "# header\nsystem:\n  name: Foo\n");
    expect(isInertSubmoduleStub(filePath)).toBe(false);
  });

  it("returns false when the file does not exist", () => {
    expect(isInertSubmoduleStub(path.join(tmpDir, "missing.yaml"))).toBe(false);
  });

  it("ignores blank lines and whitespace-only lines", () => {
    const filePath = path.join(tmpDir, "diagram-docs.yaml");
    fs.writeFileSync(filePath, "# header\n\n   \n# more\n");
    expect(isInertSubmoduleStub(filePath)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// removeStaleSubmoduleDirs
// ---------------------------------------------------------------------------

describe("removeStaleSubmoduleDirs", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeScaffold(filePath: string, customized = false): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(
      filePath,
      customized ? CUSTOMIZED_SCAFFOLD : DEFAULT_SCAFFOLD,
    );
  }

  function writeStub(filePath: string, inert = true): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(
      filePath,
      inert ? "# stub\n# system: ...\n" : "system:\n  name: Real\n",
    );
  }

  it("removes aggregator docs dir + inert stub when scaffold is untouched", () => {
    const appPath = "los-cha";
    const docsArch = path.join(tmpDir, appPath, "docs", "architecture");
    writeScaffold(path.join(docsArch, "c3-component.d2"));
    fs.mkdirSync(path.join(docsArch, "_generated"), { recursive: true });
    fs.writeFileSync(
      path.join(docsArch, "_generated", "c3-component.d2"),
      "generated\n",
    );
    writeStub(path.join(tmpDir, appPath, "diagram-docs.yaml"));

    const model: ArchitectureModel = {
      ...makeModel([]),
      containers: [
        {
          id: "los-cha",
          applicationId: "los-cha",
          name: "Los Cha",
          description: "",
          technology: "Java",
          path: "los-cha",
        },
        {
          id: "los-cha-app",
          applicationId: "los-cha-app",
          name: "App",
          description: "",
          technology: "Java",
          path: "los-cha/app",
        },
      ],
    };

    const config = configSchema.parse({ submodules: { enabled: true } });

    removeStaleSubmoduleDirs(tmpDir, model, config);

    expect(
      fs.existsSync(path.join(tmpDir, appPath, "docs", "architecture")),
    ).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, appPath, "diagram-docs.yaml"))).toBe(
      false,
    );
  });

  it("preserves aggregator docs dir when scaffold has user customizations", () => {
    const appPath = "los-cha";
    const docsArch = path.join(tmpDir, appPath, "docs", "architecture");
    writeScaffold(path.join(docsArch, "c3-component.d2"), true);
    writeStub(path.join(tmpDir, appPath, "diagram-docs.yaml"));

    const model: ArchitectureModel = {
      ...makeModel([]),
      containers: [
        {
          id: "los-cha",
          applicationId: "los-cha",
          name: "Los Cha",
          description: "",
          technology: "Java",
          path: "los-cha",
        },
        {
          id: "los-cha-app",
          applicationId: "los-cha-app",
          name: "App",
          description: "",
          technology: "Java",
          path: "los-cha/app",
        },
      ],
    };
    const config = configSchema.parse({ submodules: { enabled: true } });

    removeStaleSubmoduleDirs(tmpDir, model, config);

    expect(fs.existsSync(path.join(docsArch, "c3-component.d2"))).toBe(true);
  });

  it("preserves stub when it has user customizations (non-inert)", () => {
    const appPath = "los-cha";
    const docsArch = path.join(tmpDir, appPath, "docs", "architecture");
    writeScaffold(path.join(docsArch, "c3-component.d2"));
    writeStub(path.join(tmpDir, appPath, "diagram-docs.yaml"), false);

    const model: ArchitectureModel = {
      ...makeModel([]),
      containers: [
        {
          id: "los-cha",
          applicationId: "los-cha",
          name: "Los Cha",
          description: "",
          technology: "Java",
          path: "los-cha",
        },
        {
          id: "los-cha-app",
          applicationId: "los-cha-app",
          name: "App",
          description: "",
          technology: "Java",
          path: "los-cha/app",
        },
      ],
    };
    const config = configSchema.parse({ submodules: { enabled: true } });

    removeStaleSubmoduleDirs(tmpDir, model, config);

    expect(fs.existsSync(path.join(tmpDir, appPath, "diagram-docs.yaml"))).toBe(
      true,
    );
  });

  it("does nothing for non-aggregator containers", () => {
    const appPath = "services/user-api";
    const docsArch = path.join(tmpDir, appPath, "docs", "architecture");
    writeScaffold(path.join(docsArch, "c3-component.d2"));

    const model: ArchitectureModel = {
      ...makeModel([]),
      containers: [
        {
          id: "user-api",
          applicationId: "services-user-api",
          name: "User API",
          description: "",
          technology: "Java",
          path: "services/user-api",
        },
      ],
    };
    const config = configSchema.parse({ submodules: { enabled: true } });

    removeStaleSubmoduleDirs(tmpDir, model, config);

    expect(fs.existsSync(path.join(docsArch, "c3-component.d2"))).toBe(true);
  });

  it("skips cleanup when override.exclude is set on the aggregator", () => {
    const appPath = "los-cha";
    const docsArch = path.join(tmpDir, appPath, "docs", "architecture");
    writeScaffold(path.join(docsArch, "c3-component.d2"));

    const model: ArchitectureModel = {
      ...makeModel([]),
      containers: [
        {
          id: "los-cha",
          applicationId: "los-cha",
          name: "Los Cha",
          description: "",
          technology: "Java",
          path: "los-cha",
        },
        {
          id: "los-cha-app",
          applicationId: "los-cha-app",
          name: "App",
          description: "",
          technology: "Java",
          path: "los-cha/app",
        },
      ],
    };

    const config = configSchema.parse({
      submodules: {
        enabled: true,
        overrides: { "los-cha": { exclude: true } },
      },
    });

    removeStaleSubmoduleDirs(tmpDir, model, config);

    expect(fs.existsSync(path.join(docsArch, "c3-component.d2"))).toBe(true);
  });

  it('does not touch root docs when an aggregator has path === "."', () => {
    // Simulate a repo where an aggregator container lives at the root.
    // Under the path-ancestry rule, `collectAggregatorIds` would flag `.` if any
    // other container's path started with "./"; even though unlikely, we guard
    // against it to avoid wiping the root `docs/architecture/` site.
    const rootDocsArch = path.join(tmpDir, "docs", "architecture");
    writeScaffold(path.join(rootDocsArch, "c3-component.d2"));

    const model: ArchitectureModel = {
      ...makeModel([]),
      containers: [
        {
          id: "root",
          applicationId: "root",
          name: "Root",
          description: "",
          technology: "Java",
          path: ".",
        },
        {
          id: "child",
          applicationId: "child",
          name: "Child",
          description: "",
          technology: "Java",
          path: "./subproject",
        },
      ],
    };
    const config = configSchema.parse({ submodules: { enabled: true } });

    removeStaleSubmoduleDirs(tmpDir, model, config);

    // Root scaffold must remain untouched.
    expect(fs.existsSync(path.join(rootDocsArch, "c3-component.d2"))).toBe(
      true,
    );
  });
});
