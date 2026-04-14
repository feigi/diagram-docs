/**
 * Per-application docs scaffolding for submodule mode.
 * Creates docs folders alongside each application in the repo.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import type { ArchitectureModel } from "../../analyzers/types.js";
import type { Config } from "../../config/schema.js";
import { buildDefaultConfig } from "../../config/loader.js";
import { generateComponentDiagram } from "./component.js";
import { STYLES_D2 } from "./styles.js";
import { extractFragment } from "../../core/model-fragment.js";
import { stringify as stringifyYaml } from "yaml";

export interface SubmoduleOutputInfo {
  containerId: string;
  applicationPath: string;
  outputDir: string;
  d2Files: string[];
}

/**
 * Generate per-folder docs for each application when submodules are enabled.
 * Returns info about each generated folder for use in rendering.
 */
export function generateSubmoduleDocs(
  repoRoot: string,
  rootOutputDir: string,
  model: ArchitectureModel,
  config: Config,
): SubmoduleOutputInfo[] {
  const results: SubmoduleOutputInfo[] = [];
  const subCfg = config.submodules;
  let changedCount = 0;
  let unchangedCount = 0;

  for (const container of model.containers) {
    // Check for explicit exclude
    const override = subCfg.overrides[container.applicationId];
    if (override?.exclude) continue;

    // Use the container's path if available, otherwise fall back to applicationId
    const appPath =
      container.path ?? container.applicationId.replace(/-/g, "/");
    const docsDir = override?.docsDir ?? subCfg.docsDir;
    const outputDir = path.join(repoRoot, appPath, docsDir, "architecture");
    const generatedDir = path.join(outputDir, "_generated");

    if (!fs.existsSync(generatedDir)) {
      fs.mkdirSync(generatedDir, { recursive: true });
    }

    const d2Files: string[] = [];
    let changed = false;

    // Scaffold per-submodule config stub (create-once, gated on component-level diagrams)
    if (config.levels.component) {
      const stubPath = path.join(repoRoot, appPath, "diagram-docs.yaml");
      if (!fs.existsSync(stubPath)) {
        fs.mkdirSync(path.dirname(stubPath), { recursive: true });
        fs.writeFileSync(
          stubPath,
          buildSubmoduleConfigStub(repoRoot, appPath),
          "utf-8",
        );
        changed = true;
      }
    }

    // Generate component diagram (only when enabled)
    if (config.levels.component) {
      const d2 = generateComponentDiagram(model, container.id);
      if (writeIfChanged(path.join(generatedDir, "c3-component.d2"), d2))
        changed = true;

      // Styles
      if (writeIfChanged(path.join(outputDir, "styles.d2"), STYLES_D2))
        changed = true;

      // Scaffold user-facing c3-component.d2 (create once, never overwrite)
      const userD2Path = path.join(outputDir, "c3-component.d2");
      if (!fs.existsSync(userD2Path)) {
        // Breadcrumb link back to root
        const relToRoot = path.relative(
          outputDir,
          path.join(rootOutputDir, "c2-container.svg"),
        );

        fs.writeFileSync(
          userD2Path,
          [
            `# C4 Component Diagram — ${container.name}`,
            `# System diagrams: ${relToRoot}`,
            "",
            "...@_generated/c3-component.d2",
            "...@styles.d2",
            "",
            "# Add your customizations below this line",
            "",
          ].join("\n"),
          "utf-8",
        );
      }
      d2Files.push(userD2Path);
    }

    // Write model fragment as YAML for reference
    const fragmentContent =
      "# Architecture Model Fragment — auto-generated, do not edit\n" +
      "# This is a subset of the root model scoped to this application.\n\n" +
      stringifyYaml(fragment(model, container.id), { lineWidth: 120 });
    if (
      writeIfChanged(
        path.join(outputDir, "architecture-model.yaml"),
        fragmentContent,
      )
    )
      changed = true;

    results.push({
      containerId: container.id,
      applicationPath: appPath,
      outputDir,
      d2Files,
    });

    if (changed) {
      changedCount++;
      console.error(`Generated: ${path.relative(repoRoot, outputDir)}/`);
    } else {
      unchangedCount++;
    }
  }

  if (unchangedCount > 0 && changedCount === 0) {
    console.error(`${unchangedCount} submodule doc(s) unchanged.`);
  } else if (unchangedCount > 0) {
    console.error(`${unchangedCount} submodule doc(s) unchanged.`);
  }

  return results;
}

function fragment(model: ArchitectureModel, containerId: string) {
  return extractFragment(model, containerId);
}

function writeIfChanged(filePath: string, content: string): boolean {
  if (fs.existsSync(filePath)) {
    const existing = fs.readFileSync(filePath, "utf-8");
    if (existing === content) return false;
  }
  fs.writeFileSync(filePath, content, "utf-8");
  return true;
}

function buildSubmoduleConfigStub(repoRoot: string, appPath: string): string {
  const { config, defaults } = buildDefaultConfig(path.join(repoRoot, appPath));
  const humanName = config.system.name;

  // Every body line must be commented so the stub parses to `null` and is
  // inert under the cascading-config merge. Uncommented keys would shadow the
  // repo-root config unintentionally.
  const body = stringifyYaml(defaults, { lineWidth: 120 });
  const commentedBody = body
    .split("\n")
    .map((line) => (line.length === 0 ? "#" : `# ${line}`))
    .join("\n");

  return [
    `# diagram-docs.yaml for ${humanName}`,
    "#",
    "# Per-application config. Values here override the repo-root config",
    "# (cascading, closest parent wins). Uncomment any line below to override",
    "# the inherited default.",
    "",
    commentedBody,
  ].join("\n");
}
