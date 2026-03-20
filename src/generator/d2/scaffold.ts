import * as fs from "node:fs";
import * as path from "node:path";
import type { Config, FolderRole } from "../../config/schema.js";
import { generateStyles } from "./styles.js";

/**
 * Scaffold user-facing D2 files for a given role.
 * Diagram files are only created if missing (never overwrites user work).
 * The styles.d2 file is updated when its content changes.
 */
export function scaffoldForRole(
  outputDir: string,
  role: FolderRole,
  name: string,
  config: Config,
  parentContext?: { outputDir: string },
): void {
  // Styles file
  const stylesPath = path.join(outputDir, "styles.d2");
  const stylesContent = generateStyles(config.output.theme, config.output.layout);
  if (!fs.existsSync(stylesPath) || fs.readFileSync(stylesPath, "utf-8") !== stylesContent) {
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(stylesPath, stylesContent, "utf-8");
  }

  const breadcrumb = parentContext
    ? `# Parent: ${path.relative(outputDir, parentContext.outputDir)}/\n`
    : "";

  switch (role) {
    case "system":
      scaffoldFile(
        path.join(outputDir, "context.d2"),
        [
          "# C4 Context Diagram",
          `# System: ${name}`,
          breadcrumb,
          "...@_generated/context.d2",
          "...@styles.d2",
          "",
          "# Add your customizations below this line",
          "",
        ].join("\n"),
      );
      scaffoldFile(
        path.join(outputDir, "container.d2"),
        [
          "# C4 Container Diagram",
          `# System: ${name}`,
          breadcrumb,
          "...@_generated/container.d2",
          "...@styles.d2",
          "",
          "# Add your customizations below this line",
          "",
        ].join("\n"),
      );
      break;

    case "container":
      scaffoldFile(
        path.join(outputDir, "component.d2"),
        [
          `# C4 Component Diagram — ${name}`,
          breadcrumb,
          "...@_generated/component.d2",
          "...@styles.d2",
          "",
          "# Add your customizations below this line",
          "",
        ].join("\n"),
      );
      break;

    case "component":
    case "code-only":
      scaffoldFile(
        path.join(outputDir, "code.d2"),
        [
          `# C4 Code Diagram — ${name}`,
          breadcrumb,
          "...@_generated/code.d2",
          "...@styles.d2",
          "",
          "# Add your customizations below this line",
          "",
        ].join("\n"),
      );
      break;
  }
}

// Keep the old scaffoldUserFiles for backward compatibility with the generate command
export function scaffoldUserFiles(
  outputDir: string,
  model: import("../../analyzers/types.js").ArchitectureModel,
  config: Config,
): void {
  scaffoldForRole(outputDir, "system", model.system.name, config);
  for (const container of model.containers) {
    const containerDir = path.join(outputDir, "containers", container.id);
    scaffoldForRole(containerDir, "container", container.name, config, { outputDir });
  }
}

function scaffoldFile(filePath: string, content: string): void {
  if (fs.existsSync(filePath)) return;
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, content, "utf-8");
}
