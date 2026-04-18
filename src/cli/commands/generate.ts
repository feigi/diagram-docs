import { Command } from "commander";
import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import {
  loadConfig,
  writeDefaultConfig,
  updateConfigLLM,
  buildEffectiveConfig,
} from "../../config/loader.js";
import { loadModel } from "../../core/model.js";
import { buildModel } from "../../core/model-builder.js";
import { discoverApplications } from "../../core/discovery.js";
import { resolveConfig } from "../../core/cascading-config.js";
import {
  readProjectCache,
  writeProjectModel,
} from "../../core/per-project-cache.js";
import {
  readManifestV2,
  writeManifestV2,
  createDefaultManifestV2,
} from "../../core/manifest.js";
import { runScanAll } from "../../core/scan.js";
import { slugify } from "../../core/slugify.js";
import { generateContextDiagram } from "../../generator/d2/context.js";
import { generateContainerDiagram } from "../../generator/d2/container.js";
import { generateComponentDiagram } from "../../generator/d2/component.js";
import { generateCodeDiagram } from "../../generator/d2/code.js";
import { getProfileForLanguage } from "../../generator/d2/code-profiles.js";
import { scaffoldCodeFile } from "../../generator/d2/code-scaffold.js";
import { scaffoldUserFiles } from "../../generator/d2/scaffold.js";
import {
  generateSubmoduleDocs,
  collectAggregatorIds,
} from "../../generator/d2/submodule-scaffold.js";
import { checkDrift } from "../../generator/d2/drift.js";
import { validateD2Files } from "../../generator/d2/validate.js";
import {
  removeStaleContainerDirs,
  removeStaleSubmoduleDirs,
  removeStaleComponentDirs,
  removeStaleSubmoduleComponentDirs,
} from "../../generator/d2/cleanup.js";
import {
  codeLinkableComponentIds,
  dominantLanguageForComponent,
} from "../../generator/d2/code-helpers.js";
import type { Config } from "../../config/schema.js";
import type { ArchitectureModel, RawStructure } from "../../analyzers/types.js";
import {
  readManifest,
  writeManifest,
  createDefaultManifest,
} from "../../core/manifest.js";
import {
  buildModelWithLLM,
  serializeModel,
  attachCodeModel,
  LLMUnavailableError,
  LLMCallError,
  LLMOutputError,
} from "../../core/llm-model-builder.js";
import { formatElapsed } from "../terminal-utils.js";
import { promptLLMSetup } from "../interactive-setup.js";
import { addEdgeInteractivity } from "../../generator/d2/svg-post-process.js";

export const generateCommand = new Command("generate")
  .description("Generate D2 diagrams from an architecture model")
  .option("-m, --model <path>", "Path to architecture-model.yaml")
  .option("-c, --config <path>", "Path to diagram-docs.yaml")
  .option("--submodules", "Generate per-folder docs for each application")
  .option("--deterministic", "Use deterministic model builder (skip LLM)")
  .action(async (options, command) => {
    const globalOpts = command.optsWithGlobals();
    const startTime = Date.now();
    const {
      config: initialConfig,
      configDir,
      configCreated,
    } = loadConfig(options.config);
    let config = initialConfig;

    // Interactive LLM setup when config was just created and not deterministic.
    // The config is only in memory at this point — write to disk only after
    // the user completes the interactive prompt (or skips it).
    if (configCreated) {
      if (!options.deterministic) {
        const setup = await promptLLMSetup();
        const { configPath } = writeDefaultConfig(configDir);
        console.error(`Created ${path.relative(process.cwd(), configPath)}`);
        if (setup) {
          config = updateConfigLLM(configPath, setup.provider, setup.model);
        }
      } else {
        const { configPath } = writeDefaultConfig(configDir);
        console.error(`Created ${path.relative(process.cwd(), configPath)}`);
      }
    }

    const { model, rawStructure } = await resolveModel(
      options.model,
      configDir,
      config,
      options.deterministic,
      globalOpts.debug,
      !!options.config,
    );

    const outputDir = path.resolve(configDir, config.output.dir);
    const generatedDir = path.join(outputDir, "_generated");

    const submodulesOn = options.submodules || config.submodules.enabled;

    // Remove scaffold/generated dirs for containers deleted since last scan.
    removeStaleContainerDirs(outputDir, model);
    removeStaleComponentDirs(outputDir, model);
    removeStaleSubmoduleComponentDirs(configDir, config, model);

    // Ensure output directories exist
    if (!fs.existsSync(generatedDir)) {
      fs.mkdirSync(generatedDir, { recursive: true });
    }

    let filesWritten = 0;
    let filesUnchanged = 0;

    // Compute code-linkable component IDs once; reused by L3 root and the
    // per-submodule C3 emission so both render the same drill-down links.
    const codeLinks = config.levels.code
      ? codeLinkableComponentIds(model, config.code.minElements)
      : undefined;

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
      const useSubmoduleLinks = options.submodules || config.submodules.enabled;
      const aggregatorIds = useSubmoduleLinks
        ? collectAggregatorIds(model)
        : undefined;
      const d2 = generateContainerDiagram(model, {
        componentLinks: config.levels.component,
        format: config.output.format,
        submoduleLinkResolver: useSubmoduleLinks
          ? (containerId) =>
              resolveSubmoduleLink(
                containerId,
                model,
                config,
                outputDir,
                aggregatorIds,
              )
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

        const d2 = generateComponentDiagram(model, container.id, {
          codeLinks,
          format: config.output.format,
        });
        if (writeIfChanged(path.join(containerGenDir, "c3-component.d2"), d2)) {
          filesWritten++;
        } else {
          filesUnchanged++;
        }
      }
    }

    if (config.levels.code && !submodulesOn) {
      const codeResult = generateCodeLevelDiagrams({
        model,
        config,
        outputDir,
        rawStructure,
      });
      filesWritten += codeResult.written;
      filesUnchanged += codeResult.unchanged;
      const total = codeResult.written + codeResult.unchanged;
      console.error(
        `L4: ${total} component diagram(s) generated, ` +
          `${codeResult.skipped} skipped (below code.minElements=${config.code.minElements}).`,
      );
      if (codeResult.scaffoldFailed > 0) {
        console.error(
          `Error: ${codeResult.scaffoldFailed} L4 scaffold file(s) failed to write. Process will exit with a non-zero status.`,
        );
        process.exitCode = 1;
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
      console.error(`${filesUnchanged} generated file(s) unchanged.`);
    }

    // Check for stale references in user customizations
    const driftWarnings = checkDrift(outputDir, model, {
      repoRoot: configDir,
      config,
    });
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
    if (config.levels.code && !submodulesOn) {
      const compsByContainer = new Map<string, typeof model.components>();
      for (const c of model.components) {
        const list = compsByContainer.get(c.containerId) ?? [];
        list.push(c);
        compsByContainer.set(c.containerId, list);
      }
      const elemCountByComponent = new Map<string, number>();
      for (const e of model.codeElements ?? []) {
        elemCountByComponent.set(
          e.componentId,
          (elemCountByComponent.get(e.componentId) ?? 0) + 1,
        );
      }
      for (const container of model.containers) {
        for (const component of compsByContainer.get(container.id) ?? []) {
          if (
            (elemCountByComponent.get(component.id) ?? 0) <
            config.code.minElements
          )
            continue;
          d2Files.push(
            path.join(
              outputDir,
              "containers",
              container.id,
              "components",
              component.id,
              "c4-code.d2",
            ),
          );
        }
      }
    }

    // Per-folder submodule docs
    if (submodulesOn) {
      removeStaleSubmoduleDirs(configDir, model, config);
      const subResults = generateSubmoduleDocs(
        configDir,
        outputDir,
        model,
        config,
        {
          codeLinks,
          format: config.output.format,
          rawStructure,
        },
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

    // Post-process rendered SVGs to add interactive edge highlighting
    if (config.output.format === "svg") {
      postProcessSVGs(d2Files);
    }

    console.error(`Done in ${formatElapsed(Date.now() - startTime)}.`);
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
  debug?: boolean,
  explicitConfig?: boolean,
): Promise<{ model: ArchitectureModel; rawStructure?: RawStructure }> {
  // 1. Explicit path — trust the user
  if (modelPath) {
    return { model: loadModel(path.resolve(modelPath)) };
  }

  // 2. Discover and classify projects
  const effectiveConfig = buildEffectiveConfig(config);
  const discovered = await discoverApplications(configDir, effectiveConfig, {
    onSearching: (language, pattern) => {
      console.error(`  Searching: ${language} (${pattern})`);
    },
    onFound: (app) => {
      console.error(`  Found: ${app.path} (${app.type}: ${app.buildFile})`);
    },
  });

  if (discovered.length === 0) {
    console.error("No applications discovered.");
    process.exit(1);
  }

  const containers = discovered.filter((d) => d.type === "container");
  const libraries = discovered.filter((d) => d.type === "library");

  // 3. Per-project scan with caching (cascading per-project config)
  const getProjectConfig = explicitConfig
    ? undefined
    : (absPath: string) =>
        buildEffectiveConfig(resolveConfig(absPath, configDir));
  const { rawStructure, projectResults, staleProjects } = await runScanAll({
    rootDir: configDir,
    config: effectiveConfig,
    projects: discovered,
    getProjectConfig,
  });

  const staleContainers = staleProjects.filter((p) => p.type === "container");

  // 4. If nothing changed, reuse existing model — but first check for deletions.
  const autoModelPath = path.resolve(configDir, "architecture-model.yaml");

  if (staleContainers.length === 0 && fs.existsSync(autoModelPath)) {
    const existingModel = loadModel(autoModelPath);
    const discoveredIds = new Set(containers.map((c) => slugify(c.path)));
    const deletedContainers = existingModel.containers.filter(
      (c) => c.path != null && !discoveredIds.has(slugify(c.path)),
    );
    if (deletedContainers.length === 0) {
      console.error(
        `Using model: ${path.relative(process.cwd(), autoModelPath)} (all containers cached)`,
      );
      // Re-attach deterministic L4 data: a cached on-disk model may predate
      // when `levels.code` was enabled (or the previous build), so its
      // codeElements/codeRelationships could be missing or stale relative to
      // the current scan. attachCodeModel is a no-op when levels.code is off.
      const enriched = attachCodeModel(existingModel, rawStructure, config);
      return { model: enriched, rawStructure };
    }
    console.error(
      `${deletedContainers.length} container(s) removed since last scan: ${deletedContainers.map((c) => c.path).join(", ")}`,
    );
    // Fall through to rebuild the model without the deleted containers.
  }

  if (staleContainers.length > 0) {
    console.error(
      `${staleContainers.length} container(s) changed: ${staleContainers.map((c) => c.path).join(", ")}`,
    );
  }

  // 5. Collect cached models for unchanged containers
  const cachedModels = new Map<
    string,
    import("../../analyzers/types.js").ArchitectureModel
  >();
  for (const result of projectResults) {
    if (result.project.type !== "container") continue;
    if (result.fromCache) {
      const cache = readProjectCache(
        path.resolve(configDir, result.project.path),
      );
      if (cache?.model) {
        const appId = result.scan.applications[0]?.id;
        if (appId) cachedModels.set(appId, cache.model);
      }
    }
  }

  const libraryMeta = libraries.map((lib) => ({
    id: lib.path,
    name: path.basename(lib.path),
    language: lib.language,
    path: lib.path,
  }));

  // 6. Build model
  const builtModel = await buildModelFromScan(
    rawStructure,
    configDir,
    config,
    deterministic,
    cachedModels,
    libraryMeta,
    debug,
  );
  const model = attachCodeModel(builtModel, rawStructure, config);

  // 7. Cache per-container model fragments
  for (const container of containers) {
    const containerId = slugify(container.path);
    if (cachedModels.has(containerId)) continue;

    const containerModel: import("../../analyzers/types.js").ArchitectureModel =
      {
        version: 1,
        system: model.system,
        actors: [],
        externalSystems: [],
        containers: model.containers.filter((c) => c.id === containerId),
        components: model.components.filter(
          (c) => c.containerId === containerId,
        ),
        relationships: model.relationships.filter(
          (r) =>
            model.components.some(
              (c) =>
                c.containerId === containerId &&
                (c.id === r.sourceId || c.id === r.targetId),
            ) ||
            r.sourceId === containerId ||
            r.targetId === containerId,
        ),
      };

    writeProjectModel(path.resolve(configDir, container.path), containerModel);
  }

  // 8. Update root manifest
  const manifestV2 = readManifestV2(configDir) ?? createDefaultManifestV2();
  for (const proj of discovered) {
    const id = slugify(proj.path);
    manifestV2.projects[id] = {
      type: proj.type,
      path: proj.path,
      language: proj.language,
    };
  }
  if (staleContainers.length > 0) {
    manifestV2.synthesis = { timestamp: new Date().toISOString() };
  }
  writeManifestV2(configDir, manifestV2);

  // 9. Persist combined model
  fs.writeFileSync(autoModelPath, serializeModel(model), "utf-8");
  const manifest = readManifest(configDir) ?? createDefaultManifest();
  manifest.lastModel = {
    timestamp: new Date().toISOString(),
    checksum: rawStructure.checksum,
  };
  writeManifest(configDir, manifest);
  console.error(
    `Model written to ${path.relative(process.cwd(), autoModelPath)}`,
  );

  return { model, rawStructure };
}

async function buildModelFromScan(
  rawStructure: import("../../analyzers/types.js").RawStructure,
  configDir: string,
  config: Config,
  deterministic?: boolean,
  cachedModels?: Map<
    string,
    import("../../analyzers/types.js").ArchitectureModel
  >,
  libraries?: Array<{
    id: string;
    name: string;
    language: string;
    path: string;
  }>,
  debug?: boolean,
) {
  if (deterministic) {
    console.error("Building model (deterministic)...");
    return buildModel({ config, rawStructure, libraries });
  }

  const configPath = path.resolve(configDir, "diagram-docs.yaml");
  const configYaml = fs.existsSync(configPath)
    ? fs.readFileSync(configPath, "utf-8")
    : undefined;

  // Parallel builder manages its own UI for all app counts
  try {
    const model = await buildModelWithLLM({
      rawStructure,
      config,
      configYaml,
      cachedModels,
      libraries,
      debug,
    });
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
      console.error(
        "  Per-app agent logs may be available in .diagram-docs/logs/",
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
export function resolveSubmoduleLink(
  containerId: string,
  model: import("../../analyzers/types.js").ArchitectureModel,
  config: Config,
  rootOutputDir: string,
  aggregatorIds?: Set<string>,
): string | null {
  const container = model.containers.find((c) => c.id === containerId);
  if (!container) return null;

  const appPath = container.path ?? container.applicationId.replace(/-/g, "/");
  const override = config.submodules.overrides[container.applicationId];
  if (override?.exclude) return null;

  // Aggregator containers have no submodule site (see submodule-scaffold.ts).
  const aggregators = aggregatorIds ?? collectAggregatorIds(model);
  if (aggregators.has(container.id)) return null;

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
  let failed = 0;
  for (const d2Path of d2Files) {
    if (!fs.existsSync(d2Path)) continue;

    const ext = config.output.format;
    const outPath = d2Path.replace(/\.d2$/, `.${ext}`);
    const relPath = path.relative(process.cwd(), outPath);

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
        { stdio: "pipe", timeout: config.output.renderTimeout * 1_000 },
      );
      rendered++;
      console.error(`Rendered: ${relPath}`);
    } catch (err: unknown) {
      const errObj = err as NodeJS.ErrnoException & {
        signal?: string;
        status?: number;
      };
      const msg = err instanceof Error ? err.message : String(err);
      if (errObj.code === "ENOENT") {
        console.error(
          "Warning: d2 CLI not found. Install it to render diagram files: https://d2lang.com/releases/install",
        );
        process.exitCode = 1;
        return;
      }
      if (errObj.signal === "SIGTERM" || errObj.code === "ETIMEDOUT") {
        console.error(
          `Warning: rendering timed out for ${relPath} (diagram may be too large)`,
        );
        failed++;
        continue;
      }
      console.error(`Warning: failed to render ${relPath}: ${msg}`);
      failed++;
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
  if (failed > 0) {
    console.error(
      `Error: ${failed} diagram(s) failed to render. Process will exit with a non-zero status.`,
    );
    process.exitCode = 1;
  }
}

function isUpToDate(d2Path: string, outPath: string): boolean {
  if (!fs.existsSync(outPath)) return false;

  const outMtime = fs.statSync(outPath).mtimeMs;
  const dir = path.dirname(d2Path);
  const base = path.basename(d2Path, ".d2");

  const sources = [d2Path];

  const generatedFile = path.join(dir, "_generated", `${base}.d2`);
  if (fs.existsSync(generatedFile)) sources.push(generatedFile);

  // Walk ancestors looking for styles.d2. L1/L2 sit beside it, L3 component
  // diagrams are two levels down, L4 code diagrams four levels down. Cap the
  // walk so we never climb outside a typical project tree.
  let ancestor = dir;
  for (let i = 0; i < 8; i++) {
    const candidate = path.join(ancestor, "styles.d2");
    if (fs.existsSync(candidate)) {
      sources.push(candidate);
      break;
    }
    const parent = path.dirname(ancestor);
    if (parent === ancestor) break;
    ancestor = parent;
  }

  return sources.every((src) => fs.statSync(src).mtimeMs <= outMtime);
}

function writeIfChanged(filePath: string, content: string): boolean {
  if (fs.existsSync(filePath)) {
    const existing = fs.readFileSync(filePath, "utf-8");
    if (existing === content) return false;
  }
  fs.writeFileSync(filePath, content, "utf-8");
  return true;
}

/**
 * Generate L4 code-level diagrams (one per qualifying component) and
 * scaffold the matching user-facing files. Shared between the CLI command
 * and the integration test so wiring stays validated end-to-end.
 *
 * Components with fewer than `config.code.minElements` code elements are
 * skipped (matches the model-builder filter).
 */
export function generateCodeLevelDiagrams(opts: {
  model: ArchitectureModel;
  config: Config;
  outputDir: string;
  rawStructure?: RawStructure;
}): {
  written: number;
  unchanged: number;
  skipped: number;
  scaffoldFailed: number;
} {
  const { model, config, outputDir, rawStructure } = opts;
  let written = 0;
  let unchanged = 0;
  let skipped = 0;
  let scaffoldFailed = 0;

  const componentsByContainer = new Map<string, typeof model.components>();
  for (const c of model.components) {
    const list = componentsByContainer.get(c.containerId) ?? [];
    list.push(c);
    componentsByContainer.set(c.containerId, list);
  }
  const elementCountByComponent = new Map<string, number>();
  for (const e of model.codeElements ?? []) {
    elementCountByComponent.set(
      e.componentId,
      (elementCountByComponent.get(e.componentId) ?? 0) + 1,
    );
  }

  for (const container of model.containers) {
    const components = componentsByContainer.get(container.id) ?? [];
    for (const component of components) {
      const elementCount = elementCountByComponent.get(component.id) ?? 0;
      if (elementCount < config.code.minElements) {
        skipped++;
        continue;
      }

      const compDir = path.join(
        outputDir,
        "containers",
        container.id,
        "components",
        component.id,
      );
      const componentGenDir = path.join(compDir, "_generated");
      fs.mkdirSync(componentGenDir, { recursive: true });

      const lang = dominantLanguageForComponent(component, model, rawStructure);
      const profile = getProfileForLanguage(lang);
      const d2 = generateCodeDiagram(model, component, profile);
      if (writeIfChanged(path.join(componentGenDir, "c4-code.d2"), d2)) {
        written++;
      } else {
        unchanged++;
      }

      try {
        scaffoldCodeFile(path.join(compDir, "c4-code.d2"), {
          containerName: container.name,
          componentName: component.name,
          outputDir,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(
          `Warning: failed to scaffold c4-code.d2 for component "${component.id}" in container "${container.id}": ${msg}`,
        );
        scaffoldFailed++;
      }
    }
  }

  return { written, unchanged, skipped, scaffoldFailed };
}

/** @internal test-only alias */
export const renderD2FilesForTest = renderD2Files;

function postProcessSVGs(d2Files: string[]): void {
  for (const d2Path of d2Files) {
    const svgPath = d2Path.replace(/\.d2$/, ".svg");
    if (!fs.existsSync(svgPath)) continue;

    const original = fs.readFileSync(svgPath, "utf-8");
    // Skip files already processed (idempotent)
    if (original.includes("edge-active")) continue;

    const processed = addEdgeInteractivity(original);
    if (processed !== original) {
      fs.writeFileSync(svgPath, processed, "utf-8");
    }
  }
}
