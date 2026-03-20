import * as fs from "node:fs";
import * as path from "node:path";
import type { ArchitectureModel } from "../../analyzers/types.js";
import type { Config } from "../../config/schema.js";
import { generateStyles } from "./styles.js";

/**
 * Scaffold user-facing D2 files that @import generated files.
 * Only creates files that don't already exist — never overwrites user work.
 */
export function scaffoldUserFiles(
  outputDir: string,
  model: ArchitectureModel,
  config: Config,
): void {
  // Styles file — always overwritten (it's generated config, not user content)
  const stylesPath = path.join(outputDir, "styles.d2");
  const stylesContent = generateStyles(config.output.theme, config.output.layout);
  fs.writeFileSync(stylesPath, stylesContent, "utf-8");

  // Context diagram
  if (config.levels.context) {
    scaffoldFile(
      path.join(outputDir, "context.d2"),
      [
        "# C4 Context Diagram",
        `# System: ${model.system.name}`,
        "",
        `...@_generated/context.d2`,
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
      path.join(outputDir, "container.d2"),
      [
        "# C4 Container Diagram",
        `# System: ${model.system.name}`,
        "",
        `...@_generated/container.d2`,
        `...@styles.d2`,
        "",
        "# Add your customizations below this line",
        "",
      ].join("\n"),
    );
  }

  // Component diagrams
  if (config.levels.component) {
    const componentsDir = path.join(outputDir, "components");
    if (!fs.existsSync(componentsDir)) {
      fs.mkdirSync(componentsDir, { recursive: true });
    }

    for (const container of model.containers) {
      scaffoldFile(
        path.join(componentsDir, `${container.id}.d2`),
        [
          `# C4 Component Diagram — ${container.name}`,
          "",
          `...@../_generated/components/${container.id}.d2`,
          `...@../styles.d2`,
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
