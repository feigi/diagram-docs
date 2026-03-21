import * as fs from "node:fs";
import * as path from "node:path";
import type { ArchitectureModel } from "../../analyzers/types.js";
import type { Config } from "../../config/schema.js";
import { STYLES_D2 } from "./styles.js";

/**
 * Scaffold user-facing D2 files that @import generated files.
 * Only creates files that don't already exist — never overwrites user work.
 */
export function scaffoldUserFiles(
  outputDir: string,
  model: ArchitectureModel,
  config: Config,
): void {
  // Styles file — overwrite only if content changed (preserves mtime)
  const stylesPath = path.join(outputDir, "styles.d2");
  if (!fs.existsSync(stylesPath) || fs.readFileSync(stylesPath, "utf-8") !== STYLES_D2) {
    fs.writeFileSync(stylesPath, STYLES_D2, "utf-8");
  }

  // Context diagram
  if (config.levels.context) {
    scaffoldFile(
      path.join(outputDir, "c1-context.d2"),
      [
        "# C4 Context Diagram",
        `# System: ${model.system.name}`,
        "",
        `...@_generated/c1-context.d2`,
        `...@styles.d2`,
        "",
        "# Add your customizations below this line",
        "",
      ].join("\n"),
    );
  }

  // Container diagram
  if (config.levels.container) {
    scaffoldFile(
      path.join(outputDir, "c2-container.d2"),
      [
        "# C4 Container Diagram",
        `# System: ${model.system.name}`,
        "",
        `...@_generated/c2-container.d2`,
        `...@styles.d2`,
        "",
        "# Add your customizations below this line",
        "",
      ].join("\n"),
    );
  }

  // Component diagrams
  if (config.levels.component) {
    for (const container of model.containers) {
      const containerDir = path.join(outputDir, "containers", container.id);
      if (!fs.existsSync(containerDir)) {
        fs.mkdirSync(containerDir, { recursive: true });
      }

      scaffoldFile(
        path.join(containerDir, "c3-component.d2"),
        [
          `# C4 Component Diagram — ${container.name}`,
          "",
          `...@_generated/c3-component.d2`,
          `...@../../styles.d2`,
          "",
          "# Add your customizations below this line",
          "",
        ].join("\n"),
      );
    }
  }
}

function scaffoldFile(filePath: string, content: string): void {
  if (fs.existsSync(filePath)) return; // Never overwrite user files
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, content, "utf-8");
}
