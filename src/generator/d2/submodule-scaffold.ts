/**
 * Per-application docs scaffolding for submodule mode.
 * Creates docs folders alongside each application in the repo.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import type { ArchitectureModel, RawStructure } from "../../analyzers/types.js";
import type { Config } from "../../config/schema.js";
import { buildDefaultConfig } from "../../config/loader.js";
import { generateComponentDiagram } from "./component.js";
import { generateCodeDiagram } from "./code.js";
import { scaffoldCodeFile } from "./code-scaffold.js";
import { dominantLanguageForComponent } from "./code-helpers.js";
import { getProfileForLanguage } from "./code-profiles.js";
import { STYLES_D2 } from "./styles.js";
import { extractFragment } from "../../core/model-fragment.js";
import { stringify as stringifyYaml } from "yaml";

/**
 * Returns the set of container ids whose `path` is a strict ancestor of
 * another container's `path`. These are treated as aggregators (e.g. a
 * Gradle multi-project root) and are skipped during per-folder docs
 * generation because their real content lives in child containers.
 */
export function collectAggregatorIds(model: ArchitectureModel): Set<string> {
  const paths = model.containers
    .map((c) => ({ id: c.id, path: c.path }))
    .filter((c): c is { id: string; path: string } => !!c.path);

  const aggregators = new Set<string>();
  for (const a of paths) {
    for (const b of paths) {
      if (a.id === b.id) continue;
      if (b.path.startsWith(a.path + "/")) {
        aggregators.add(a.id);
        break;
      }
    }
  }
  return aggregators;
}

export interface SubmoduleOutputInfo {
  containerId: string;
  applicationPath: string;
  outputDir: string;
  d2Files: string[];
}

export interface SubmoduleDocsResult {
  outputs: SubmoduleOutputInfo[];
  /** Number of L4 scaffold/generation failures caught across all submodules. */
  scaffoldFailed: number;
}

export interface GenerateSubmoduleDocsOptions {
  codeLinks?: Set<string>;
  format?: string;
  rawStructure?: RawStructure;
}

type Container = ArchitectureModel["containers"][number];

export interface SubmodulePaths {
  /** Repo-relative path from the repo root to the app directory (no leading slash). */
  appPath: string;
  /** Per-container docs dir name, after override resolution. */
  docsDir: string;
  /** Absolute path to `{repoRoot}/{appPath}/{docsDir}/architecture`. */
  architectureDir: string;
}

export function resolveSubmodulePaths(
  repoRoot: string,
  container: Container,
  config: Config,
): SubmodulePaths {
  const override = config.submodules.overrides[container.applicationId];
  const appPath = container.path ?? container.applicationId.replace(/-/g, "/");
  const docsDir = override?.docsDir ?? config.submodules.docsDir;
  const architectureDir = path.join(repoRoot, appPath, docsDir, "architecture");
  return { appPath, docsDir, architectureDir };
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
  options?: GenerateSubmoduleDocsOptions,
): SubmoduleDocsResult {
  const results: SubmoduleOutputInfo[] = [];
  const subCfg = config.submodules;
  const aggregatorIds = collectAggregatorIds(model);
  let unchangedCount = 0;
  let scaffoldFailed = 0;

  for (const container of model.containers) {
    // Check for explicit exclude
    const override = subCfg.overrides[container.applicationId];
    if (override?.exclude) continue;

    // Skip aggregator containers (path is ancestor of another container).
    // Their real content lives in child subprojects that get their own site.
    if (aggregatorIds.has(container.id)) continue;

    // A container with path === "." would resolve to the repo root and
    // collide with the root site. Skip defensively.
    if (container.path === ".") continue;

    const { appPath, architectureDir: outputDir } = resolveSubmodulePaths(
      repoRoot,
      container,
      config,
    );
    const generatedDir = path.join(outputDir, "_generated");

    if (!fs.existsSync(generatedDir)) {
      fs.mkdirSync(generatedDir, { recursive: true });
    }

    const d2Files: string[] = [];
    let changed = false;

    if (config.levels.component) {
      // Scaffold per-submodule config stub (create-once). Logged separately
      // and does not flip `changed` — matches the user-facing c3-component.d2
      // scaffold below, where create-once artifacts are announced by their own
      // path rather than folded into the per-container "Generated:" summary.
      const stubPath = path.join(repoRoot, appPath, "diagram-docs.yaml");
      if (!fs.existsSync(stubPath)) {
        fs.writeFileSync(
          stubPath,
          buildSubmoduleConfigStub(repoRoot, appPath),
          "utf-8",
        );
        console.error(`Scaffolded: ${path.relative(repoRoot, stubPath)}`);
      }

      // Generate component diagram
      const d2 = generateComponentDiagram(model, container.id, {
        codeLinks: options?.codeLinks,
        format: options?.format ?? config.output.format,
      });
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

    if (config.levels.code) {
      const elementCountByComponent = new Map<string, number>();
      for (const e of model.codeElements ?? []) {
        if (e.containerId !== container.id) continue;
        elementCountByComponent.set(
          e.componentId,
          (elementCountByComponent.get(e.componentId) ?? 0) + 1,
        );
      }

      for (const component of model.components.filter(
        (c) => c.containerId === container.id,
      )) {
        const count = elementCountByComponent.get(component.id) ?? 0;
        if (count < config.code.minElements) continue;

        const compDir = path.join(outputDir, "components", component.id);
        const compGenDir = path.join(compDir, "_generated");
        fs.mkdirSync(compGenDir, { recursive: true });

        try {
          const lang = dominantLanguageForComponent(
            component,
            model,
            options?.rawStructure,
          );
          const profile = getProfileForLanguage(lang);
          const d2 = generateCodeDiagram(model, component, profile);
          const genPath = path.join(compGenDir, "c4-code.d2");
          if (writeIfChanged(genPath, d2)) changed = true;

          scaffoldCodeFile(path.join(compDir, "c4-code.d2"), {
            containerName: container.name,
            componentName: component.name,
            outputDir,
          });
          d2Files.push(path.join(compDir, "c4-code.d2"));
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(
            `Warning: L4: failed to generate L4 for "${component.id}" in "${container.id}": ${msg}`,
          );
          scaffoldFailed++;
        }
      }
    }

    results.push({
      containerId: container.id,
      applicationPath: appPath,
      outputDir,
      d2Files,
    });

    if (changed) {
      console.error(`Generated: ${path.relative(repoRoot, outputDir)}/`);
    } else {
      unchangedCount++;
    }
  }

  if (unchangedCount > 0) {
    console.error(`${unchangedCount} submodule doc(s) unchanged.`);
  }

  return { outputs: results, scaffoldFailed };
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
