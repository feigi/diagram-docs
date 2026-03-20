/**
 * Per-application docs scaffolding for submodule mode.
 * Creates docs folders alongside each application in the repo.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import type { ArchitectureModel } from "../../analyzers/types.js";
import type { Config } from "../../config/schema.js";
import { generateComponentDiagram } from "./component.js";
import { generateStyles } from "./styles.js";
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

  for (const container of model.containers) {
    // Check for explicit skip in overrides
    const override = config.overrides[container.applicationId];
    if (override?.role === "skip") continue;

    // Use the container's path if available, otherwise fall back to applicationId
    const appPath = container.path ?? container.applicationId.replace(/-/g, "/");
    const docsDir = config.output.docsDir;
    const outputDir = path.join(repoRoot, appPath, docsDir, "architecture");
    const generatedDir = path.join(outputDir, "_generated");

    if (!fs.existsSync(generatedDir)) {
      fs.mkdirSync(generatedDir, { recursive: true });
    }

    const d2Files: string[] = [];

    // Generate component diagram
    const d2 = generateComponentDiagram(model, container.id);
    writeIfChanged(path.join(generatedDir, "component.d2"), d2);

    // Styles
    const styles = generateStyles(config.output.theme, config.output.layout);
    writeIfChanged(path.join(outputDir, "styles.d2"), styles);

    // Scaffold user-facing component.d2 (create once, never overwrite)
    const userD2Path = path.join(outputDir, "component.d2");
    if (!fs.existsSync(userD2Path)) {
      // Breadcrumb link back to root
      const relToRoot = path.relative(
        outputDir,
        path.join(rootOutputDir, "container.svg"),
      );

      fs.writeFileSync(
        userD2Path,
        [
          `# C4 Component Diagram — ${container.name}`,
          `# System diagrams: ${relToRoot}`,
          "",
          "...@_generated/component.d2",
          "...@styles.d2",
          "",
          "# Add your customizations below this line",
          "",
        ].join("\n"),
        "utf-8",
      );
    }
    d2Files.push(userD2Path);

    // Write model fragment as YAML for reference
    const fragmentContent =
      "# Architecture Model Fragment — auto-generated, do not edit\n" +
      "# This is a subset of the root model scoped to this application.\n\n" +
      stringifyYaml(fragment(model, container.id), { lineWidth: 120 });
    writeIfChanged(path.join(outputDir, "architecture-model.yaml"), fragmentContent);

    results.push({
      containerId: container.id,
      applicationPath: appPath,
      outputDir,
      d2Files,
    });

    console.error(
      `Generated: ${path.relative(repoRoot, outputDir)}/`,
    );
  }

  return results;
}

function fragment(model: ArchitectureModel, containerId: string) {
  return extractFragment(model, containerId);
}

function writeIfChanged(filePath: string, content: string): void {
  if (fs.existsSync(filePath)) {
    const existing = fs.readFileSync(filePath, "utf-8");
    if (existing === content) return;
  }
  fs.writeFileSync(filePath, content, "utf-8");
}
