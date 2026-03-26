import { Command } from "commander";
import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { loadConfig } from "../../config/loader.js";
import { loadModel } from "../../core/model.js";
import { buildModel } from "../../core/model-builder.js";
import { generateContextDiagram } from "../../generator/d2/context.js";
import { generateContainerDiagram } from "../../generator/d2/container.js";
import { generateComponentDiagram } from "../../generator/d2/component.js";
import { scaffoldUserFiles } from "../../generator/d2/scaffold.js";
import { generateSubmoduleDocs } from "../../generator/d2/submodule-scaffold.js";
import { checkDrift } from "../../generator/d2/drift.js";
import { validateD2Files } from "../../generator/d2/validate.js";
import type { Config } from "../../config/schema.js";
import { runScan, ScanError } from "../../core/scan.js";
import { readManifest, writeManifest, createDefaultManifest } from "../../core/manifest.js";
import {
  buildModelWithLLM,
  serializeModel,
  LLMUnavailableError,
  LLMCallError,
  LLMOutputError,
} from "../../core/llm-model-builder.js";
import { createFrame } from "../frame.js";

export const generateCommand = new Command("generate")
  .description("Generate D2 diagrams from an architecture model")
  .option("-m, --model <path>", "Path to architecture-model.yaml")
  .option("-c, --config <path>", "Path to diagram-docs.yaml")
  .option("--submodules", "Generate per-folder docs for each application")
  .option("--deterministic", "Use deterministic model builder (skip LLM)")
  .action(async (options) => {
    const { config, configDir } = loadConfig(options.config);
    const model = await resolveModel(options.model, configDir, config, options.deterministic);

    const outputDir = path.resolve(configDir, config.output.dir);
    const generatedDir = path.join(outputDir, "_generated");

    // Ensure output directories exist
    if (!fs.existsSync(generatedDir)) {
      fs.mkdirSync(generatedDir, { recursive: true });
    }

    let filesWritten = 0;
    let filesUnchanged = 0;

    // L1: Context diagram
    if (config.levels.context) {
      const d2 = generateContextDiagram(model);
      if (writeIfChanged(path.join(generatedDir, "c1-context.d2"), d2)) {
        filesWritten++;
      } else {
        filesUnchanged++;
      }
    }

    // L2: Container diagram
    if (config.levels.container) {
      const useSubmoduleLinks =
        options.submodules || config.submodules.enabled;
      const d2 = generateContainerDiagram(model, {
        componentLinks: config.levels.component,
        format: config.output.format,
        submoduleLinkResolver: useSubmoduleLinks
          ? (containerId) => resolveSubmoduleLink(containerId, model, config, outputDir)
          : undefined,
      });
      if (writeIfChanged(path.join(generatedDir, "c2-container.d2"), d2)) {
        filesWritten++;
      } else {
        filesUnchanged++;
      }
    }

    // L3: Component diagrams (one per container)
    if (config.levels.component) {
      for (const container of model.containers) {
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
        if (writeIfChanged(path.join(containerGenDir, "c3-component.d2"), d2)) {
          filesWritten++;
        } else {
          filesUnchanged++;
        }
      }
    }

    // Scaffold user-facing files (only creates, never overwrites)
    scaffoldUserFiles(outputDir, model, config);

    if (filesWritten > 0) {
      console.error(
        `Done. ${filesWritten} generated file(s) written to ${config.output.dir}/`,
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
    if (config.levels.context) {
      d2Files.push(path.join(outputDir, "c1-context.d2"));
    }
    if (config.levels.container) {
      d2Files.push(path.join(outputDir, "c2-container.d2"));
    }
    if (config.levels.component) {
      for (const container of model.containers) {
        d2Files.push(
          path.join(outputDir, "containers", container.id, "c3-component.d2"),
        );
      }
    }

    // Per-folder submodule docs
    if (options.submodules || config.submodules.enabled) {
      const subResults = generateSubmoduleDocs(
        configDir,
        outputDir,
        model,
        config,
      );
      for (const sub of subResults) {
        d2Files.push(...sub.d2Files);
      }
    }

    // Validate generated D2 files
    const validation = validateD2Files(d2Files);
    if (validation && validation.errors.length > 0) {
      for (const err of validation.errors) {
        console.error(`Validation error: ${err.file}: ${err.message}`);
      }
      process.exit(1);
    }

    renderD2Files(d2Files, config);
  });

/**
 * Resolve model: explicit path > scan + staleness check > rebuild.
 *
 * Always scans first (cheap — cached if source is unchanged) so we can
 * detect when the model is stale relative to the current source code.
 */
async function resolveModel(
  modelPath: string | undefined,
  configDir: string,
  config: Config,
  deterministic?: boolean,
) {
  // 1. Explicit path provided — trust the user, skip staleness check
  if (modelPath) {
    return loadModel(path.resolve(modelPath));
  }

  // 2. Always scan (returns from cache if source unchanged)
  let scanResult;
  try {
    scanResult = await runScan({ rootDir: configDir, config });
  } catch (err) {
    if (err instanceof ScanError) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
    throw err;
  }
  const { rawStructure } = scanResult;
  const scanChecksum = rawStructure.checksum;

  // 3. Check if existing model is still fresh
  const autoModelPath = path.resolve(configDir, ".diagram-docs", "architecture-model.yaml");
  const manifest = readManifest(configDir) ?? createDefaultManifest();

  if (fs.existsSync(autoModelPath)) {
    if (manifest.lastModel?.checksum === scanChecksum) {
      console.error(`Using model: ${path.relative(process.cwd(), autoModelPath)} (up to date)`);
      return loadModel(autoModelPath);
    }
    console.error("Source code changed since model was last built. Rebuilding model...");
  }

  // 4. Build model: LLM (default) or deterministic (--deterministic)
  const model = await buildModelFromScan(rawStructure, configDir, config, deterministic);

  // 5. Persist model and record scan checksum
  fs.writeFileSync(autoModelPath, serializeModel(model), "utf-8");
  manifest.lastModel = {
    timestamp: new Date().toISOString(),
    checksum: scanChecksum,
  };
  writeManifest(configDir, manifest);
  console.error(`Model written to ${path.relative(process.cwd(), autoModelPath)}`);

  return model;
}

/**
 * Build an architecture model from scan output using deterministic or LLM mode.
 */
async function buildModelFromScan(
  rawStructure: import("../../analyzers/types.js").RawStructure,
  configDir: string,
  config: Config,
  deterministic?: boolean,
) {
  if (deterministic) {
    console.error("Building model (deterministic)...");
    return buildModel({ config, rawStructure });
  }

  const configPath = path.resolve(configDir, "diagram-docs.yaml");
  const configYaml = fs.existsSync(configPath)
    ? fs.readFileSync(configPath, "utf-8")
    : undefined;

  const frame = createFrame("LLM Agent");
  try {
    const model = await buildModelWithLLM({
      rawStructure,
      config,
      configYaml,
      onStatus(status) {
        frame.update([
          { text: status, spinner: true },
          { text: `Model: ${config.llm.model}` },
        ]);
      },
      onProgress({ line, final: done, kind }) {
        frame.log(line, done, kind);
      },
    });
    frame.stop([
      {
        text: `${model.containers.length} container(s), ` +
          `${model.components.length} component(s), ` +
          `${model.relationships.length} relationship(s)`,
      },
    ]);
    return model;
  } catch (err) {
    if (err instanceof LLMUnavailableError) {
      console.error(`\n${err.message}`);
      process.exit(1);
    }
    if (err instanceof LLMCallError) {
      console.error(
        `\nError: ${err.message}\n\n` +
          "To retry, check your CLI installation and authentication.\n" +
          "Or use the deterministic builder:\n" +
          "  diagram-docs generate --deterministic",
      );
      process.exit(1);
    }
    if (err instanceof LLMOutputError) {
      console.error(
        `\nError: ${err.message}\n\n` +
          "The LLM produced output that could not be parsed as a valid model.\n" +
          "Try again, or use the deterministic builder:\n" +
          "  diagram-docs generate --deterministic",
      );
      if (err.rawOutput) {
        console.error(`\nRaw output (first 500 chars):\n${err.rawOutput}`);
      }
      process.exit(1);
    }
    throw err;
  }
}

/**
 * Resolve a container drill-down link for submodule mode.
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
  const override = config.submodules.overrides[container.applicationId];
  if (override?.exclude) return null;

  const docsDir = override?.docsDir ?? config.submodules.docsDir;
  const targetDir = path.resolve(
    path.dirname(rootOutputDir),
    "..",
    appPath,
    docsDir,
    "architecture",
  );
  const ext = config.output.format;
  const targetFile = path.join(targetDir, `c3-component.${ext}`);

  return path.relative(rootOutputDir, targetFile);
}

function renderD2Files(d2Files: string[], config: Config): void {
  if (d2Files.length === 0) return;

  let rendered = 0;
  let skipped = 0;
  for (const d2Path of d2Files) {
    if (!fs.existsSync(d2Path)) continue;

    const ext = config.output.format;
    const outPath = d2Path.replace(/\.d2$/, `.${ext}`);
    const relPath = path.relative(process.cwd(), outPath);

    // Skip rendering if the output is already newer than all D2 inputs.
    // The user-facing D2 file imports _generated/*.d2 and styles.d2,
    // so check all three.
    if (isUpToDate(d2Path, outPath)) {
      skipped++;
      continue;
    }

    try {
      execFileSync(
        "d2",
        [
          `--theme=${config.output.theme}`,
          `--layout=${config.output.layout}`,
          d2Path,
          outPath,
        ],
        { stdio: "pipe", timeout: 30_000 },
      );
      rendered++;
      console.error(`Rendered: ${relPath}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("ENOENT")) {
        console.error(
          "Warning: d2 CLI not found. Install it to render diagram files: https://d2lang.com/releases/install",
        );
        return;
      }
      if (msg.includes("ETIMEDOUT") || msg.includes("killed")) {
        console.error(`Warning: rendering timed out for ${relPath} (diagram may be too large)`);
        continue;
      }
      console.error(`Warning: failed to render ${relPath}: ${msg}`);
    }
  }
  if (rendered > 0) {
    console.error(
      `Rendered ${rendered} ${config.output.format.toUpperCase()} file(s).`,
    );
  }
  if (skipped > 0) {
    console.error(`Skipped ${skipped} unchanged file(s).`);
  }
}

/**
 * Check if the rendered output is up-to-date with all D2 source files
 * that contribute to it (the user file, its _generated/ import, and styles.d2).
 */
function isUpToDate(d2Path: string, outPath: string): boolean {
  if (!fs.existsSync(outPath)) return false;

  const outMtime = fs.statSync(outPath).mtimeMs;
  const dir = path.dirname(d2Path);
  const base = path.basename(d2Path, ".d2");

  // Collect all D2 files that feed into this output
  const sources = [d2Path];

  const generatedFile = path.join(dir, "_generated", `${base}.d2`);
  if (fs.existsSync(generatedFile)) sources.push(generatedFile);

  const stylesFile = path.join(dir, "styles.d2");
  if (fs.existsSync(stylesFile)) sources.push(stylesFile);

  // For component diagrams nested in containers/, styles.d2 is two levels up
  const parentStyles = path.join(dir, "..", "..", "styles.d2");
  if (fs.existsSync(parentStyles)) sources.push(parentStyles);

  return sources.every((src) => fs.statSync(src).mtimeMs <= outMtime);
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
