import { Command } from "commander";
import * as fs from "node:fs";
import * as path from "node:path";
import { loadConfig } from "../../config/loader.js";
import { loadModel } from "../../core/model.js";
import { buildModel } from "../../core/model-builder.js";
import { generateContextDiagram } from "../../generator/d2/context.js";
import { generateContainerDiagram } from "../../generator/d2/container.js";
import { generateComponentDiagram } from "../../generator/d2/component.js";
import { scaffoldUserFiles } from "../../generator/d2/scaffold.js";
import { checkDrift } from "../../generator/d2/drift.js";
import { renderD2Files } from "../../generator/d2/render.js";
import type { Config } from "../../config/schema.js";
import type { RawStructure } from "../../analyzers/types.js";

export const generateCommand = new Command("generate")
  .description("Generate D2 diagrams from an architecture model")
  .option("-m, --model <path>", "Path to architecture-model.yaml")
  .option("-c, --config <path>", "Path to diagram-docs.yaml")
  .action((options) => {
    const { config, configDir } = loadConfig(options.config);
    const model = resolveModel(options.model, configDir, config);

    const outputDir = path.resolve(configDir, config.output.docsDir, "architecture");
    const generatedDir = path.join(outputDir, "_generated");

    // Ensure output directories exist
    if (!fs.existsSync(generatedDir)) {
      fs.mkdirSync(generatedDir, { recursive: true });
    }

    let filesWritten = 0;
    let filesUnchanged = 0;

    // L1: Context diagram — always generated
    {
      const d2 = generateContextDiagram(model);
      if (writeIfChanged(path.join(generatedDir, "context.d2"), d2)) {
        filesWritten++;
      } else {
        filesUnchanged++;
      }
    }

    // L2: Container diagram — always generated
    {
      const d2 = generateContainerDiagram(model, {
        componentLinks: true,
        format: config.output.format,
        submoduleLinkResolver: (containerId) =>
          resolveSubmoduleLink(containerId, model, config, outputDir),
      });
      if (writeIfChanged(path.join(generatedDir, "container.d2"), d2)) {
        filesWritten++;
      } else {
        filesUnchanged++;
      }
    }

    // L3: Component diagrams (one per container) — gated by levels.component
    if (config.levels.component) {
      for (const container of model.containers) {
        try {
          const containerGenDir = path.join(
            outputDir,
            "containers",
            container.id,
            "_generated",
          );
          if (!fs.existsSync(containerGenDir)) {
            fs.mkdirSync(containerGenDir, { recursive: true });
          }

          const d2 = generateComponentDiagram(model, container.id);
          if (writeIfChanged(path.join(containerGenDir, "component.d2"), d2)) {
            filesWritten++;
          } else {
            filesUnchanged++;
          }
        } catch (err: unknown) {
          const errCode = (err as NodeJS.ErrnoException).code;
          if (errCode === "ENOSPC" || errCode === "ENOMEM" || errCode === "EROFS") {
            throw err;
          }
          console.error(
            `Warning: component diagram failed for ${container.id}: ${err instanceof Error ? err.message : err}`,
          );
        }
      }
    }

    // Scaffold user-facing files (only creates, never overwrites)
    scaffoldUserFiles(outputDir, model, config);

    const archDir = path.join(config.output.docsDir, "architecture");
    if (filesWritten > 0) {
      console.error(
        `Done. ${filesWritten} generated file(s) written to ${archDir}/`,
      );
    }
    if (filesUnchanged > 0) {
      console.error(
        `${filesUnchanged} generated file(s) unchanged.`,
      );
    }

    // Check for stale references in user customizations
    const driftWarnings = checkDrift(outputDir, model);
    for (const w of driftWarnings) {
      console.error(`Warning: ${w.file}:${w.line}: ${w.message}`);
    }

    // Collect all D2 files to render
    const d2Files: string[] = [];
    d2Files.push(path.join(outputDir, "context.d2"));
    d2Files.push(path.join(outputDir, "container.d2"));
    if (config.levels.component) {
      for (const container of model.containers) {
        d2Files.push(
          path.join(outputDir, "containers", container.id, "component.d2"),
        );
      }
    }

    const result = renderD2Files(d2Files, config);
    if (result.failed > 0) {
      process.exitCode = 1;
    }
  });

/**
 * Resolve model: explicit path > auto-locate > auto-generate from raw scan.
 */
function resolveModel(
  modelPath: string | undefined,
  configDir: string,
  config: Config,
) {
  // 1. Explicit path provided
  if (modelPath) {
    return loadModel(path.resolve(modelPath));
  }

  // 2. Look for architecture-model.yaml near config
  const autoModelPath = path.resolve(configDir, "architecture-model.yaml");
  if (fs.existsSync(autoModelPath)) {
    console.error(`Using model: ${path.relative(process.cwd(), autoModelPath)}`);
    return loadModel(autoModelPath);
  }

  // 3. Auto-generate from raw-structure.json
  const rawPath = path.resolve(configDir, ".diagram-docs/raw-structure.json");
  if (fs.existsSync(rawPath)) {
    console.error(
      "No architecture-model.yaml found. Auto-generating from raw-structure.json...",
    );
    const rawStructure: RawStructure = JSON.parse(
      fs.readFileSync(rawPath, "utf-8"),
    );
    return buildModel({ config, rawStructure });
  }

  console.error(
    "Error: No model found. Provide --model, place architecture-model.yaml in the project root,\n" +
      "or run 'diagram-docs scan' first so the model can be auto-generated.",
  );
  process.exit(1);
}

/**
 * Resolve a container drill-down link.
 * Returns relative path from root output dir to the per-folder component diagram.
 */
function resolveSubmoduleLink(
  containerId: string,
  model: import("../../analyzers/types.js").ArchitectureModel,
  config: Config,
  rootOutputDir: string,
): string | null {
  const container = model.containers.find((c) => c.id === containerId);
  if (!container) return null;

  const appPath = container.path ?? container.applicationId.replace(/-/g, "/");

  // Check overrides for skip role — use path-based key to match recursive runner convention
  const override = config.overrides[appPath] ?? config.overrides[container.applicationId];
  if (override?.role === "skip") return null;

  const docsDir = override?.docsDir ?? config.output.docsDir;
  const targetDir = path.resolve(
    path.dirname(rootOutputDir),
    "..",
    appPath,
    docsDir,
    "architecture",
  );
  const ext = config.output.format;
  const targetFile = path.join(targetDir, `component.${ext}`);

  return path.relative(rootOutputDir, targetFile);
}

/**
 * Write a file only if its content has changed.
 * Returns true if the file was written, false if it was already up-to-date.
 */
function writeIfChanged(filePath: string, content: string): boolean {
  if (fs.existsSync(filePath)) {
    const existing = fs.readFileSync(filePath, "utf-8");
    if (existing === content) return false;
  }
  fs.writeFileSync(filePath, content, "utf-8");
  return true;
}
