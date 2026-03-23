/**
 * Parallel model building: split, merge, and orchestration for multi-app
 * architecture modeling with concurrent LLM calls.
 */
import type { RawStructure, ArchitectureModel } from "../analyzers/types.js";
import type { Config } from "../config/schema.js";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { buildModel } from "./model-builder.js";
import { architectureModelSchema } from "./model.js";
import {
  type LLMProvider,
  type ProgressEvent,
  LLMCallError,
  LLMOutputError,
  isProgrammingError,
  rethrowIfFatal,
  isRecoverableLLMError,
  buildPerAppSystemPrompt,
  buildPerAppUserMessage,
  buildSynthesisSystemPrompt,
  buildSynthesisUserMessage,
  repairLLMYaml,
} from "./llm-model-builder.js";
import { z } from "zod";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import chalk from "chalk";
import { createParallelProgress } from "../cli/parallel-progress.js";
import { createFrame } from "../cli/frame.js";
import { AgentLogger } from "./agent-logger.js";

/** Result of building a single app — tracks whether it degraded to deterministic mode. */
interface AppBuildResult {
  readonly model: ArchitectureModel;
  readonly fellBack: boolean;
}

/** Relationship deduplication key — centralizes the `source→target` convention. */
function relKey(sourceId: string, targetId: string): string {
  return `${sourceId}->${targetId}`;
}

// ---------------------------------------------------------------------------
// Split & Merge
// ---------------------------------------------------------------------------

/**
 * Split a multi-app RawStructure into one RawStructure per application.
 * Each slice contains the full ScannedApplication object, so fields like
 * internalImports remain available for LLM context.
 */
export function splitRawStructure(raw: RawStructure): RawStructure[] {
  return raw.applications.map((app) => ({
    version: raw.version,
    scannedAt: raw.scannedAt,
    checksum: raw.checksum,
    applications: [app],
  }));
}

/**
 * Merge partial ArchitectureModels (one per app) into a combined model.
 * - Concatenates containers and components
 * - Deduplicates relationships by source→target pair (first wins)
 * - Deduplicates actors by id (keeps longer description)
 * - Deduplicates external systems by id (keeps longer description)
 * - System name/description left empty (filled by synthesis pass)
 */
export function mergePartialModels(
  partials: ArchitectureModel[],
): ArchitectureModel {
  const containers: ArchitectureModel["containers"] = [];
  const components: ArchitectureModel["components"] = [];
  const relationships: ArchitectureModel["relationships"] = [];
  const relKeys = new Set<string>();
  const actorMap = new Map<string, ArchitectureModel["actors"][0]>();
  const externalMap = new Map<
    string,
    ArchitectureModel["externalSystems"][0]
  >();

  for (const partial of partials) {
    containers.push(...partial.containers);
    components.push(...partial.components);
    for (const rel of partial.relationships) {
      const key = relKey(rel.sourceId, rel.targetId);
      if (!relKeys.has(key)) {
        relKeys.add(key);
        relationships.push(rel);
      }
    }

    for (const actor of partial.actors) {
      const existing = actorMap.get(actor.id);
      if (
        !existing ||
        actor.description.length > existing.description.length
      ) {
        actorMap.set(actor.id, actor);
      }
    }

    for (const ext of partial.externalSystems) {
      const existing = externalMap.get(ext.id);
      if (
        !existing ||
        ext.description.length > existing.description.length
      ) {
        externalMap.set(ext.id, ext);
      }
    }
  }

  return {
    version: 1,
    system: { name: "", description: "" },
    actors: [...actorMap.values()],
    externalSystems: [...externalMap.values()],
    containers,
    components,
    relationships,
  };
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const synthesisSchema = z.object({
  system: z.object({
    name: z.string().min(1),
    description: z.string(),
  }).partial().optional(),
  actors: z.array(z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    description: z.string(),
  })).optional(),
  externalSystems: z.array(z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    description: z.string(),
    technology: z.string().optional(),
  })).optional(),
  relationships: z.array(z.object({
    sourceId: z.string().min(1),
    targetId: z.string().min(1),
    label: z.string().min(1),
    technology: z.string().optional(),
  })).optional(),
});

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

export interface ParallelBuildOptions {
  readonly rawStructure: RawStructure;
  readonly config: Config;
  readonly configYaml?: string;
  readonly provider: LLMProvider;
  readonly onStatus?: (status: string) => void;
  readonly onProgress?: (event: ProgressEvent) => void;
}

/**
 * Build an architecture model by dispatching parallel per-app LLM calls,
 * then merging results with deterministic cross-app relationships and a
 * synthesis pass for system-level metadata.
 */
export async function buildModelParallel(
  options: ParallelBuildOptions,
): Promise<ArchitectureModel> {
  const { rawStructure, config, configYaml, provider, onStatus, onProgress } =
    options;
  const concurrency = config.llm.concurrency;

  // -- Log directory setup --
  const logsDir = path.join(".diagram-docs", "logs");
  const manageOwnUI = !onStatus && !onProgress;

  if (manageOwnUI) {
    fs.rmSync(logsDir, { recursive: true, force: true });
    fs.mkdirSync(logsDir, { recursive: true });

    try {
      const gitignorePath = ".gitignore";
      if (fs.existsSync(gitignorePath)) {
        const gitignore = fs.readFileSync(gitignorePath, "utf-8");
        if (!gitignore.includes(".diagram-docs/logs")) {
          process.stderr.write(
            chalk.yellow("Warning: .diagram-docs/logs/ is not in .gitignore\n"),
          );
        }
      }
    } catch (e) { rethrowIfFatal(e); /* gitignore check is advisory */ }
  }

  const warn = (msg: string) => {
    if (onStatus) {
      onStatus(msg);
    } else if (progress) {
      progress.setStatus(msg);
    } else {
      try { process.stderr.write(`${msg}\n`); } catch (e) { if (isProgrammingError(e)) throw e; }
    }
  };

  if (rawStructure.applications.length < 2) {
    throw new LLMCallError(
      `Parallel model building requires at least 2 applications but received ${rawStructure.applications.length}. ` +
      `Single-app structures should use the standard model builder.`,
    );
  }

  const progress = manageOwnUI
    ? createParallelProgress(config.llm.model)
    : undefined;

  // -- Step 1: Split into per-app slices --
  const slices = splitRawStructure(rawStructure);
  onStatus?.(`Split into ${slices.length} per-app slices`);

  if (progress) {
    const appIds = slices.map((s) => s.applications[0].id);
    progress.setApps(appIds);
  }

  // -- Step 2: Build per-app deterministic seeds --
  const seeds: ArchitectureModel[] = [];
  for (let i = 0; i < slices.length; i++) {
    try {
      seeds.push(buildModel({ config, rawStructure: slices[i] }));
    } catch (err) {
      const appId = slices[i].applications[0].id;
      progress?.stop(`Seed generation failed for ${appId}`);
      rethrowIfFatal(err);
      throw new LLMCallError(
        `Failed to generate deterministic seed for app "${appId}": ${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      );
    }
  }

  // -- Step 3: Dispatch parallel LLM calls with concurrency limit --
  let running = 0;
  const queue: Array<() => void> = [];

  function acquireSlot(): Promise<void> {
    if (running < concurrency) {
      running++;
      return Promise.resolve();
    }
    return new Promise((resolve) => queue.push(resolve));
  }

  function releaseSlot(): void {
    running--;
    const next = queue.shift();
    if (next) {
      running++;
      next();
    }
  }

  /** Best-effort removal of a temp file; warns on non-ENOENT errors. */
  function cleanupFile(filePath: string | undefined): void {
    if (!filePath) return;
    try { fs.unlinkSync(filePath); } catch (e) {
      rethrowIfFatal(e);
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
        warn(`Failed to clean up temp file ${filePath}: ${(e as Error).message}`);
      }
    }
  }

  async function buildOneApp(
    slice: RawStructure,
    seed: ArchitectureModel,
    index: number,
  ): Promise<AppBuildResult> {
    await acquireSlot();
    const app = slice.applications[0];
    // Sanitize app.id to prevent path traversal (app.id comes from scanned source code)
    const safeAppId = app.id.replace(/[^a-zA-Z0-9_-]/g, "_");

    const logger = manageOwnUI
      ? new AgentLogger(
          path.join(logsDir, `agent-${safeAppId}.log`),
          { appId: app.id, model: config.llm.model, provider: provider.name },
        )
      : undefined;

    const appStartTime = Date.now();

    try {

      let currentAppState: "queued" | "thinking" | "output" = "queued";
      const appOnProgress = manageOwnUI
        ? (event: ProgressEvent) => {
            logger!.logProgress(event);
            const newState = event.kind;
            if (newState !== currentAppState) {
              currentAppState = newState;
              progress!.updateApp(app.id, newState);
            }
          }
        : onProgress;

      if (progress) {
        progress.updateApp(app.id, "thinking");
      } else {
        onStatus?.(`Modeling app ${index + 1}/${slices.length}: ${app.id}`);
      }

      const seedYaml = stringifyYaml(seed, { lineWidth: 120 });
      const outputPath = provider.supportsTools
        ? path.join(
            os.tmpdir(),
            `diagram-docs-parallel-${safeAppId}-${Date.now()}.yaml`,
          )
        : undefined;

      const systemPrompt = buildPerAppSystemPrompt(outputPath);
      const userMessage = buildPerAppUserMessage({
        app,
        configYaml,
        seedYaml,
        outputPath,
      });

      logger?.logPrompt(systemPrompt, userMessage);

      let textOutput: string;
      try {
        textOutput = await provider.generate(
          systemPrompt,
          userMessage,
          config.llm.model,
          appOnProgress,
        );
      } catch (err) {
        cleanupFile(outputPath);
        if (err instanceof LLMCallError || err instanceof LLMOutputError) throw err;
        rethrowIfFatal(err);
        throw new LLMCallError(
          `Provider error: ${err instanceof Error ? err.message : String(err)}`,
          { cause: err },
        );
      }

      // Read output — prefer file written by tool-using agent, fall back to text

      let rawOutput: string;
      if (outputPath && fs.existsSync(outputPath)) {
        try {
          rawOutput = fs.readFileSync(outputPath, "utf-8");
          if (!rawOutput.trim()) {
            if (textOutput.trim()) {
              warn(`App ${slice.applications[0].id}: agent output file was empty, using text stream`);
              rawOutput = textOutput;
            } else {
              throw new LLMOutputError("Agent wrote an empty output file and no text output was streamed");
            }
          }
        } catch (err: unknown) {
          if (err instanceof LLMOutputError) throw err;
          rethrowIfFatal(err);
          const errCode = (err as NodeJS.ErrnoException).code;
          if (errCode !== "ENOENT") {
            // System I/O errors (EACCES, EISDIR, etc.) should propagate,
            // not fall back to deterministic seed — they indicate a system problem.
            throw err;
          }
          if (!textOutput.trim()) {
            throw new LLMCallError(
              `Failed to read agent output file and no text output was streamed`,
              { cause: err },
            );
          }
          warn(`App ${slice.applications[0].id}: failed to read output file (${errCode}), using text stream`);
          rawOutput = textOutput;
        } finally {
          cleanupFile(outputPath);
        }
      } else {
        rawOutput = textOutput;
      }

      // Strip markdown fences
      rawOutput = rawOutput
        .trim()
        .replace(/^```ya?ml\s*\n?/i, "")
        .replace(/\n?```\s*$/i, "");

      // Find YAML start
      if (
        !rawOutput.startsWith("version:") &&
        !rawOutput.startsWith("---")
      ) {
        const yamlStart = rawOutput.indexOf("\nversion:");
        if (yamlStart !== -1) {
          warn(`App ${app.id}: Stripped ${yamlStart} characters of preamble text before YAML`);
          rawOutput = rawOutput.slice(yamlStart + 1);
        }
      }

      // Repair common LLM YAML issues
      const repair = repairLLMYaml(rawOutput);
      rawOutput = repair.yaml;
      if (repair.linesSplit > 0 || repair.linesRemoved > 0) {
        warn(
          `App ${app.id}: Repaired LLM YAML: ${repair.linesSplit} smashed lines split, ` +
            `${repair.linesRemoved} trailing broken lines removed`,
        );
      }

      if (!rawOutput.trim()) {
        throw new LLMOutputError("LLM output was empty after cleanup", rawOutput);
      }

      let parsed: unknown;
      try {
        parsed = parseYaml(rawOutput);
      } catch (parseErr) {
        throw new LLMOutputError(
          `Failed to parse LLM output as YAML for app ${app.id}: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`,
          rawOutput,
          { cause: parseErr },
        );
      }
      try {
        const model = architectureModelSchema.parse(parsed) as ArchitectureModel;
        progress?.updateApp(app.id, "done");
        await logger?.logDone(Date.now() - appStartTime);
        return { model, fellBack: false };
      } catch (schemaErr) {
        throw new LLMOutputError(
          `LLM output failed schema validation for app ${app.id}: ${schemaErr instanceof Error ? schemaErr.message : String(schemaErr)}`,
          rawOutput,
          { cause: schemaErr },
        );
      }
    } catch (err) {
      // Only fall back for LLM/output errors; let programming errors propagate
      if (isRecoverableLLMError(err)) {
        const msg = err instanceof Error ? err.message : String(err);
        progress?.updateApp(slice.applications[0].id, "failed");
        await logger?.logFailed(msg, Date.now() - appStartTime);
        warn(
          `App ${slice.applications[0].id}: LLM failed (${msg}), using deterministic seed`,
        );
        return { model: seed, fellBack: true };
      }
      throw err;
    } finally {
      releaseSlot();
    }
  }

  const partialPromises = slices.map((slice, i) =>
    buildOneApp(slice, seeds[i], i),
  );
  const settled = await Promise.allSettled(partialPromises);

  // Collect results — programming errors (rejected promises) must propagate,
  // not silently degrade to deterministic seeds.
  const results: AppBuildResult[] = [];
  const rejections: unknown[] = [];
  for (let i = 0; i < settled.length; i++) {
    const outcome = settled[i];
    if (outcome.status === "fulfilled") {
      results.push(outcome.value);
    } else {
      rejections.push(outcome.reason);
    }
  }
  if (rejections.length > 0) {
    // Log additional rejections so they are not silently lost
    for (let i = 1; i < rejections.length; i++) {
      warn(`Additional app error (${i + 1}/${rejections.length}): ${rejections[i] instanceof Error ? (rejections[i] as Error).message : String(rejections[i])}`);
    }
    progress?.stop(`${results.filter(r => !r.fellBack).length}/${slices.length} apps modeled`);
    throw rejections[0];
  }

  const fallbackCount = results.filter((r) => r.fellBack).length;
  if (fallbackCount === slices.length) {
    progress?.stop(`0/${slices.length} apps modeled`);
    throw new LLMCallError(
      `All ${slices.length} per-app LLM calls failed. ` +
      `The result would be identical to --deterministic mode. ` +
      `Check LLM provider availability and authentication.`,
    );
  }
  if (fallbackCount > 0) {
    const fellBackIds = results
      .map((r, i) => r.fellBack ? slices[i].applications[0].id : null)
      .filter((id): id is string => id !== null);
    warn(
      `WARNING: ${fallbackCount}/${slices.length} apps fell back to deterministic modeling: [${fellBackIds.join(", ")}]`,
    );
  }

  const doneCount = results.filter((r) => !r.fellBack).length;
  if (progress) {
    progress.stop(`${doneCount}/${slices.length} apps modeled`);
  }

  const partials = results.map((r) => r.model);

  // -- Step 4: Merge partial models --
  onStatus?.("Merging per-app models...");
  const merged = mergePartialModels(partials);

  // -- Step 5: Inject deterministic cross-app relationships --
  onStatus?.("Adding cross-app relationships...");
  let fullDeterministic: ArchitectureModel;
  try {
    fullDeterministic = buildModel({ config, rawStructure });
  } catch (err) {
    rethrowIfFatal(err);
    throw new LLMCallError(
      `Failed to build deterministic model for cross-app relationships: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  }

  const containerIds = new Set(merged.containers.map((c) => c.id));
  const componentIds = new Set(merged.components.map((c) => c.id));
  const existingRelKeys = new Set(
    merged.relationships.map((r) => relKey(r.sourceId, r.targetId)),
  );

  // Cross-app container-level relationships
  const crossAppContainerRels = fullDeterministic.relationships.filter(
    (r) => containerIds.has(r.sourceId) && containerIds.has(r.targetId) && r.sourceId !== r.targetId,
  );

  // Cross-app component-level relationships (source and target in different containers)
  const componentToContainer = new Map<string, string>();
  for (const comp of merged.components) {
    componentToContainer.set(comp.id, comp.containerId);
  }
  const deterministicCrossAppComponentRels = fullDeterministic.relationships.filter((r) => {
    const srcContainer = componentToContainer.get(r.sourceId) ?? (containerIds.has(r.sourceId) ? r.sourceId : undefined);
    const tgtContainer = componentToContainer.get(r.targetId) ?? (containerIds.has(r.targetId) ? r.targetId : undefined);
    // Both endpoints must be components (not containers, not external systems)
    if (!r.sourceId || !r.targetId) return false;
    if (containerIds.has(r.sourceId) || containerIds.has(r.targetId)) return false;
    return srcContainer != null && tgtContainer != null && srcContainer !== tgtContainer;
  });
  const crossAppComponentRels = deterministicCrossAppComponentRels.filter(
    (r) => componentIds.has(r.sourceId) && componentIds.has(r.targetId),
  );

  // Warn if deterministic model had cross-app component rels but LLM changed component IDs
  if (crossAppComponentRels.length === 0 && deterministicCrossAppComponentRels.length > 0) {
    warn(
      `WARNING: ${deterministicCrossAppComponentRels.length} cross-app component relationship(s) ` +
      `could not be injected because LLM-generated component IDs do not match the deterministic model`,
    );
  }

  for (const rel of [...crossAppContainerRels, ...crossAppComponentRels]) {
    const key = relKey(rel.sourceId, rel.targetId);
    if (!existingRelKeys.has(key)) {
      existingRelKeys.add(key);
      merged.relationships.push(rel);
    }
  }

  // -- Step 6: Synthesis pass --
  const synthesisFrame = manageOwnUI ? createFrame("LLM Synthesis") : undefined;
  const synthesisOnStatus = manageOwnUI
    ? (status: string) => synthesisFrame!.update([
        { text: status, spinner: true },
        { text: `Model: ${config.llm.model}` },
      ])
    : onStatus;
  const synthesisOnProgress = manageOwnUI
    ? (event: ProgressEvent) => synthesisFrame!.log(event.line, event.final, event.kind)
    : onProgress;

  synthesisOnStatus?.("Running synthesis pass...");
  // Save pre-synthesis state so the catch block can fully rollback.
  // Rollback restores system name/description to config defaults,
  // replaces actors and externalSystems arrays wholesale,
  // and restores relationship labels/technology from saved values.
  const preSynthActors = [...merged.actors];
  const preSynthExternalSystems = [...merged.externalSystems];
  const preSynthRelationships = merged.relationships.map((r) => ({ ...r }));
  try {
    const crossAppRels = merged.relationships.filter((r) => {
      const srcContainer = containerIds.has(r.sourceId)
        ? r.sourceId
        : componentToContainer.get(r.sourceId);
      const tgtContainer = containerIds.has(r.targetId)
        ? r.targetId
        : componentToContainer.get(r.targetId);
      // Both endpoints must resolve to a container — exclude external system rels
      return srcContainer != null && tgtContainer != null && srcContainer !== tgtContainer;
    });

    const synthesisSystem = buildSynthesisSystemPrompt();
    const synthesisUser = buildSynthesisUserMessage({
      containers: merged.containers.map((c) => ({
        id: c.id,
        name: c.name,
        description: c.description,
        technology: c.technology,
      })),
      actors: merged.actors,
      externalSystems: merged.externalSystems,
      crossAppRelationships: crossAppRels,
    });

    let synthesisOutput: string;
    try {
      synthesisOutput = await provider.generate(
        synthesisSystem,
        synthesisUser,
        config.llm.model,
        synthesisOnProgress,
      );
    } catch (err) {
      if (err instanceof LLMCallError || err instanceof LLMOutputError) throw err;
      rethrowIfFatal(err);
      throw new LLMCallError(
        `Provider error during synthesis: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      );
    }

    // Parse synthesis output
    let synthesisYaml = synthesisOutput
      .trim()
      .replace(/^```ya?ml\s*\n?/i, "")
      .replace(/\n?```\s*$/i, "");

    if (
      !synthesisYaml.startsWith("system:") &&
      !synthesisYaml.startsWith("---")
    ) {
      const start = synthesisYaml.indexOf("\nsystem:");
      if (start !== -1) {
        warn(`Synthesis: Stripped ${start} characters of preamble text before YAML`);
        synthesisYaml = synthesisYaml.slice(start + 1);
      }
    }

    const repaired = repairLLMYaml(synthesisYaml);
    if (repaired.linesSplit > 0 || repaired.linesRemoved > 0) {
      warn(
        `Synthesis: Repaired LLM YAML: ${repaired.linesSplit} smashed lines split, ` +
          `${repaired.linesRemoved} trailing broken lines removed`,
      );
    }

    let parsed: unknown;
    try {
      parsed = parseYaml(repaired.yaml);
    } catch (parseErr) {
      throw new LLMOutputError(
        `Failed to parse synthesis output as YAML: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`,
        repaired.yaml,
        { cause: parseErr },
      );
    }
    let synthesis: z.infer<typeof synthesisSchema>;
    try {
      synthesis = synthesisSchema.parse(parsed);
    } catch (schemaErr) {
      throw new LLMOutputError(
        `Synthesis output failed schema validation: ${schemaErr instanceof Error ? schemaErr.message : String(schemaErr)}`,
        repaired.yaml,
        { cause: schemaErr },
      );
    }

    // Apply all mutations atomically — collect first, then apply
    const newSystemName = synthesis.system?.name;
    const newSystemDesc = synthesis.system?.description;
    const newActors = synthesis.actors && synthesis.actors.length > 0
      ? synthesis.actors
      : undefined;
    const newExternalSystems = synthesis.externalSystems && synthesis.externalSystems.length > 0
      ? synthesis.externalSystems
      : undefined;

    let relUpdates: Map<string, { label: string; technology?: string }> | undefined;
    if (synthesis.relationships) {
      relUpdates = new Map();
      for (const rel of synthesis.relationships) {
        relUpdates.set(relKey(rel.sourceId, rel.targetId), {
          label: rel.label,
          technology: rel.technology,
        });
      }
    }

    // All validation passed — now apply
    if (newSystemName) merged.system.name = newSystemName;
    if (newSystemDesc !== undefined) merged.system.description = newSystemDesc;
    if (newActors) merged.actors = newActors;
    if (newExternalSystems) {
      // Preserve technology from pre-synthesis when synthesis omits it
      const preTechMap = new Map(
        merged.externalSystems.map((es) => [es.id, es.technology]),
      );
      for (const es of newExternalSystems) {
        if (!es.technology) {
          const preTech = preTechMap.get(es.id);
          if (preTech) es.technology = preTech;
        }
      }
      merged.externalSystems = newExternalSystems;
    }
    if (relUpdates) {
      for (const rel of merged.relationships) {
        const key = relKey(rel.sourceId, rel.targetId);
        const synthRel = relUpdates.get(key);
        if (synthRel && synthRel.label !== rel.label) {
          rel.label = synthRel.label;
        }
        if (synthRel?.technology && synthRel.technology !== rel.technology) {
          rel.technology = synthRel.technology;
        }
      }
    }
  } catch (err) {
    if (isRecoverableLLMError(err)) {
      const msg = err instanceof Error ? err.message : String(err);
      synthesisFrame?.stop([{ text: `Synthesis failed: ${msg}` }]);
      warn(
        `Synthesis failed (${msg}): rolling back system name/description to config defaults, ` +
        `actors and external systems to pre-synthesis state, ` +
        `and relationship labels to pre-synthesis values`,
      );
      merged.system.name = config.system.name;
      merged.system.description = config.system.description;
      merged.actors = preSynthActors;
      merged.externalSystems = preSynthExternalSystems;
      merged.relationships = preSynthRelationships;
    } else {
      synthesisFrame?.stop([{ text: "Synthesis error" }]);
      throw err;
    }
  }

  if (synthesisFrame) {
    synthesisFrame.stop([{ text: "Synthesis complete" }]);
  }

  // Fallback: if system name/description are still empty (synthesis succeeded
  // but omitted the system fields, or synthesis rolled back), use config defaults.
  if (!merged.system.name) merged.system.name = config.system.name;
  if (!merged.system.description) merged.system.description = config.system.description;

  return merged;
}
