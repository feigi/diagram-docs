import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { removeStaleComponentDirs } from "../../../src/generator/d2/cleanup.js";
import type { ArchitectureModel } from "../../../src/analyzers/types.js";

describe("removeStaleComponentDirs", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pr5-stale-comp-"));
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const model: ArchitectureModel = {
    version: 1,
    system: { name: "", description: "" },
    actors: [],
    externalSystems: [],
    containers: [
      {
        id: "c1",
        applicationId: "a1",
        name: "C1",
        description: "",
        technology: "",
      },
    ],
    components: [
      {
        id: "comp-active",
        containerId: "c1",
        name: "A",
        description: "",
        technology: "",
        moduleIds: [],
      },
    ],
    relationships: [],
  };

  it("removes pristine scaffold + generated dirs for orphan components", () => {
    const orphanDir = path.join(
      tmp,
      "containers",
      "c1",
      "components",
      "comp-orphan",
    );
    fs.mkdirSync(path.join(orphanDir, "_generated"), { recursive: true });
    fs.writeFileSync(
      path.join(orphanDir, "_generated", "c4-code.d2"),
      "# gen\n",
    );
    fs.writeFileSync(
      path.join(orphanDir, "c4-code.d2"),
      "# Add your customizations below this line\n",
    );

    removeStaleComponentDirs(tmp, model);
    expect(fs.existsSync(orphanDir)).toBe(false);
  });

  it("preserves user-modified orphan scaffolds and warns", () => {
    const orphanDir = path.join(
      tmp,
      "containers",
      "c1",
      "components",
      "comp-orphan",
    );
    fs.mkdirSync(path.join(orphanDir, "_generated"), { recursive: true });
    fs.writeFileSync(
      path.join(orphanDir, "_generated", "c4-code.d2"),
      "# gen\n",
    );
    fs.writeFileSync(
      path.join(orphanDir, "c4-code.d2"),
      "# Add your customizations below this line\nmy-edit\n",
    );

    removeStaleComponentDirs(tmp, model);
    expect(fs.existsSync(path.join(orphanDir, "c4-code.d2"))).toBe(true);
    expect(fs.existsSync(path.join(orphanDir, "_generated"))).toBe(false);
  });

  it("leaves active components untouched", () => {
    const activeDir = path.join(
      tmp,
      "containers",
      "c1",
      "components",
      "comp-active",
    );
    fs.mkdirSync(activeDir, { recursive: true });
    fs.writeFileSync(
      path.join(activeDir, "c4-code.d2"),
      "# Add your customizations below this line\n",
    );
    removeStaleComponentDirs(tmp, model);
    expect(fs.existsSync(activeDir)).toBe(true);
  });
});
