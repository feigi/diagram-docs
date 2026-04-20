import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { generateSubmoduleDrawio } from "../../../src/generator/drawio/submodule.js";
import type { ArchitectureModel } from "../../../src/analyzers/types.js";
import { configSchema } from "../../../src/config/schema.js";

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ddocs-dw-sub-"));
}

describe("generateSubmoduleDrawio", () => {
  it("writes a c3-component.drawio per non-aggregator container", async () => {
    const repo = tmp();
    fs.mkdirSync(path.join(repo, "services/auth"), { recursive: true });
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
          id: "h",
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
    await generateSubmoduleDrawio(repo, model, cfg);
    expect(
      fs.existsSync(
        path.join(repo, "services/auth/docs/architecture/c3-component.drawio"),
      ),
    ).toBe(true);
  });

  it("skips aggregator containers", async () => {
    const repo = tmp();
    fs.mkdirSync(path.join(repo, "apps/parent/child"), { recursive: true });
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
    await generateSubmoduleDrawio(repo, model, cfg);
    expect(
      fs.existsSync(
        path.join(repo, "apps/parent/docs/architecture/c3-component.drawio"),
      ),
    ).toBe(false);
    expect(
      fs.existsSync(
        path.join(
          repo,
          "apps/parent/child/docs/architecture/c3-component.drawio",
        ),
      ),
    ).toBe(true);
  });
});
