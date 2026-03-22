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
  buildPerAppSystemPrompt,
  buildPerAppUserMessage,
  buildSynthesisSystemPrompt,
  buildSynthesisUserMessage,
  repairLLMYaml,
} from "./llm-model-builder.js";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// Split & Merge (Task 7)
// ---------------------------------------------------------------------------

/**
 * Split a multi-app RawStructure into one RawStructure per application.
 * Each slice preserves the app's internalImports for LLM context.
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
 * - Concatenates containers, components, relationships
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
  const actorMap = new Map<string, ArchitectureModel["actors"][0]>();
  const externalMap = new Map<
    string,
    ArchitectureModel["externalSystems"][0]
  >();

  for (const partial of partials) {
    containers.push(...partial.containers);
    components.push(...partial.components);
    relationships.push(...partial.relationships);

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
// Orchestration (Task 8)
// ---------------------------------------------------------------------------

export interface ParallelBuildOptions {
  rawStructure: RawStructure;
  config: Config;
  configYaml?: string;
  provider: LLMProvider;
  onStatus?: (status: string) => void;
  onProgress?: (event: ProgressEvent) => void;
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

  // -- Step 1: Split into per-app slices --
  const slices = splitRawStructure(rawStructure);
  onStatus?.(`Split into ${slices.length} per-app slices`);

  // -- Step 2: Build per-app deterministic seeds --
  const seeds = slices.map((slice) =>
    buildModel({ config, rawStructure: slice }),
  );

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

  async function buildOneApp(
    slice: RawStructure,
    seed: ArchitectureModel,
    index: number,
  ): Promise<ArchitectureModel> {
    await acquireSlot();
    try {
      const app = slice.applications[0];
      onStatus?.(`Modeling app ${index + 1}/${slices.length}: ${app.id}`);

      const seedYaml = stringifyYaml(seed, { lineWidth: 120 });
      const outputPath = provider.supportsTools
        ? path.join(
            os.tmpdir(),
            `diagram-docs-parallel-${app.id}-${Date.now()}.yaml`,
          )
        : undefined;

      const systemPrompt = buildPerAppSystemPrompt(outputPath);
      const userMessage = buildPerAppUserMessage({
        app,
        configYaml,
        seedYaml,
        outputPath,
      });

      let textOutput: string;
      try {
        textOutput = await provider.generate(
          systemPrompt,
          userMessage,
          config.llm.model,
          onProgress,
        );
      } catch (err) {
        if (outputPath) {
          try {
            fs.unlinkSync(outputPath);
          } catch {
            /* cleanup is best-effort */
          }
        }
        throw err;
      }

      // Read output — prefer file written by tool-using agent, fall back to text
      let rawOutput: string;
      if (outputPath && fs.existsSync(outputPath)) {
        try {
          rawOutput = fs.readFileSync(outputPath, "utf-8");
          if (!rawOutput.trim()) {
            rawOutput = textOutput;
          }
        } catch {
          rawOutput = textOutput;
        } finally {
          try {
            fs.unlinkSync(outputPath);
          } catch {
            /* cleanup is best-effort */
          }
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
          rawOutput = rawOutput.slice(yamlStart + 1);
        }
      }

      // Repair common LLM YAML issues
      const repair = repairLLMYaml(rawOutput);
      rawOutput = repair.yaml;

      if (!rawOutput.trim()) {
        throw new Error("LLM output was empty after cleanup");
      }

      // Parse and validate
      const parsed = parseYaml(rawOutput);
      return architectureModelSchema.parse(parsed) as ArchitectureModel;
    } catch (err) {
      // Fall back to deterministic seed for this app
      const msg = err instanceof Error ? err.message : String(err);
      onStatus?.(
        `App ${slice.applications[0].id}: LLM failed (${msg}), using deterministic seed`,
      );
      return seed;
    } finally {
      releaseSlot();
    }
  }

  const partialPromises = slices.map((slice, i) =>
    buildOneApp(slice, seeds[i], i),
  );
  const partials = await Promise.all(partialPromises);

  // -- Step 4: Merge partial models --
  onStatus?.("Merging per-app models...");
  const merged = mergePartialModels(partials);

  // -- Step 5: Inject deterministic cross-app relationships --
  onStatus?.("Adding cross-app relationships...");
  const fullDeterministic = buildModel({ config, rawStructure });

  const containerIds = new Set(merged.containers.map((c) => c.id));
  const componentIds = new Set(merged.components.map((c) => c.id));
  const existingRelKeys = new Set(
    merged.relationships.map((r) => `${r.sourceId}->${r.targetId}`),
  );

  // Cross-app container-level relationships
  const crossAppContainerRels = fullDeterministic.relationships.filter(
    (r) => containerIds.has(r.sourceId) && containerIds.has(r.targetId),
  );

  // Cross-app component-level relationships (source and target in different containers)
  const componentToContainer = new Map<string, string>();
  for (const comp of merged.components) {
    componentToContainer.set(comp.id, comp.containerId);
  }
  const crossAppComponentRels = fullDeterministic.relationships.filter((r) => {
    if (!componentIds.has(r.sourceId) || !componentIds.has(r.targetId))
      return false;
    const srcContainer = componentToContainer.get(r.sourceId);
    const tgtContainer = componentToContainer.get(r.targetId);
    return srcContainer !== tgtContainer;
  });

  for (const rel of [...crossAppContainerRels, ...crossAppComponentRels]) {
    const key = `${rel.sourceId}->${rel.targetId}`;
    if (!existingRelKeys.has(key)) {
      existingRelKeys.add(key);
      merged.relationships.push(rel);
    }
  }

  // -- Step 6: Synthesis pass --
  onStatus?.("Running synthesis pass...");
  try {
    const crossAppRels = merged.relationships.filter((r) => {
      const srcContainer = containerIds.has(r.sourceId)
        ? r.sourceId
        : componentToContainer.get(r.sourceId);
      const tgtContainer = containerIds.has(r.targetId)
        ? r.targetId
        : componentToContainer.get(r.targetId);
      return srcContainer !== tgtContainer;
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

    const synthesisOutput = await provider.generate(
      synthesisSystem,
      synthesisUser,
      config.llm.model,
      onProgress,
    );

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
        synthesisYaml = synthesisYaml.slice(start + 1);
      }
    }

    const repaired = repairLLMYaml(synthesisYaml);
    const synthesis = parseYaml(repaired.yaml) as {
      system?: { name?: string; description?: string };
      actors?: ArchitectureModel["actors"];
      externalSystems?: ArchitectureModel["externalSystems"];
      relationships?: ArchitectureModel["relationships"];
    };

    // Apply system info
    if (synthesis.system?.name) {
      merged.system.name = synthesis.system.name;
    }
    if (synthesis.system?.description) {
      merged.system.description = synthesis.system.description;
    }

    // Replace actors/externals if synthesis provides them
    if (synthesis.actors && synthesis.actors.length > 0) {
      merged.actors = synthesis.actors;
    }
    if (synthesis.externalSystems && synthesis.externalSystems.length > 0) {
      merged.externalSystems = synthesis.externalSystems;
    }

    // Update cross-app relationship labels (prefer synthesis label over "Uses"/"Calls")
    if (synthesis.relationships) {
      const synthRelMap = new Map<string, string>();
      for (const rel of synthesis.relationships) {
        synthRelMap.set(`${rel.sourceId}->${rel.targetId}`, rel.label);
      }
      for (const rel of merged.relationships) {
        const key = `${rel.sourceId}->${rel.targetId}`;
        const synthLabel = synthRelMap.get(key);
        if (synthLabel && synthLabel !== rel.label) {
          rel.label = synthLabel;
        }
      }
    }
  } catch (err) {
    // Fall back to config values for system info
    const msg = err instanceof Error ? err.message : String(err);
    onStatus?.(`Synthesis failed (${msg}), using config defaults`);
    merged.system.name = config.system.name;
    merged.system.description = config.system.description;
  }

  return merged;
}
