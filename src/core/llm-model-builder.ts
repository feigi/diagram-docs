/**
 * LLM-powered architecture model generation via CLI delegation.
 * Delegates to Claude Code CLI or GitHub Copilot CLI — no SDK dependency.
 */
import { execFileSync, spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type { Config } from "../config/schema.js";
import type { RawStructure, ArchitectureModel } from "../analyzers/types.js";
import { architectureModelSchema } from "./model.js";
import { buildModel } from "./model-builder.js";

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

export class LLMUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LLMUnavailableError";
  }
}

export class LLMCallError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LLMCallError";
  }
}

export class LLMOutputError extends Error {
  constructor(
    message: string,
    public readonly rawOutput?: string,
  ) {
    super(message);
    this.name = "LLMOutputError";
  }
}

// ---------------------------------------------------------------------------
// Async spawn helper
// ---------------------------------------------------------------------------

/**
 * Spawn a process, write data to stdin, and collect stdout.
 * Uses async spawn to avoid pipe buffer deadlocks with large inputs.
 */
function spawnWithStdin(
  cmd: string,
  args: string[],
  stdinData: string,
  timeoutMs: number,
  onStderr?: (line: string) => void,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    let timedOut = false;
    let stderrBuf = "";

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);

    child.stdout.on("data", (chunk) => chunks.push(chunk));
    child.stderr.on("data", (chunk) => {
      errChunks.push(chunk);
      if (onStderr) {
        stderrBuf += chunk.toString();
        const lines = stderrBuf.split("\n");
        stderrBuf = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed) onStderr(trimmed);
        }
      }
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(new LLMCallError(`Failed to spawn ${cmd}: ${err.message}`));
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new LLMCallError(`${cmd} timed out after ${timeoutMs / 1000}s`));
        return;
      }
      if (code !== 0) {
        const stderr = Buffer.concat(errChunks).toString().trim();
        const stdout = Buffer.concat(chunks).toString().trim();
        reject(
          new LLMCallError(
            `${cmd} exited with code ${code}: ${stderr || stdout || "(no output)"}`,
          ),
        );
        return;
      }
      resolve(Buffer.concat(chunks).toString("utf-8"));
    });

    // Write stdin data and close the stream
    child.stdin.write(stdinData, () => {
      child.stdin.end();
    });
  });
}

// ---------------------------------------------------------------------------
// Streaming JSON spawn helper (for Claude Code CLI)
// ---------------------------------------------------------------------------

/**
 * Spawn a process using stream-json output format.
 * Parses streaming JSON events from stdout to extract text and report progress.
 */
export interface ProgressEvent {
  line: string;
  /** true when this line is complete (a newline was seen); false while still being built */
  final: boolean;
  /** "thinking" for internal reasoning, "output" for actual generated content */
  kind: "thinking" | "output";
}

function spawnStreamJson(
  cmd: string,
  args: string[],
  stdinData: string,
  timeoutMs: number,
  onProgress?: (event: ProgressEvent) => void,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"] });
    let resultText = "";
    let thinkingText = "";
    let lastTextLineCount = 1;
    let lastThinkLineCount = 1;
    let stdoutBuf = "";
    const errChunks: Buffer[] = [];
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdoutBuf += chunk.toString();
      const lines = stdoutBuf.split("\n");
      stdoutBuf = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line);
          // Text delta — token-by-token streaming
          const delta = event.event?.delta ?? event.delta;
          if (delta?.type === "text_delta" && delta.text) {
            resultText += delta.text;
            if (onProgress) {
              const lines = resultText.trimEnd().split("\n");
              const lastLine = lines[lines.length - 1]?.trim();
              // New line started → push previous as finished
              if (lines.length > lastTextLineCount) {
                const prev = lines[lines.length - 2]?.trim();
                if (prev) onProgress({ line: prev, final: true, kind: "output" });
                lastTextLineCount = lines.length;
              }
              if (lastLine) onProgress({ line: lastLine, final: false, kind: "output" });
            }
          }
          // Thinking delta — accumulate and show last line
          if (delta?.type === "thinking_delta" && delta.thinking) {
            thinkingText += delta.thinking;
            if (onProgress) {
              const lines = thinkingText.trimEnd().split("\n");
              const lastLine = lines[lines.length - 1]?.trim();
              if (lines.length > lastThinkLineCount) {
                const prev = lines[lines.length - 2]?.trim();
                if (prev) onProgress({ line: prev, final: true, kind: "thinking" });
                lastThinkLineCount = lines.length;
              }
              if (lastLine) onProgress({ line: lastLine, final: false, kind: "thinking" });
            }
          }
          // Result event — use as fallback only if no deltas were accumulated.
          // The result field may be truncated for large outputs, while the
          // accumulated text_delta stream is the ground truth.
          if (event.type === "result" && typeof event.result === "string" && !resultText) {
            resultText = event.result;
          }
        } catch { /* skip unparseable lines */ }
      }
    });

    child.stderr.on("data", (chunk) => errChunks.push(chunk));

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(new LLMCallError(`Failed to spawn ${cmd}: ${err.message}`));
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new LLMCallError(`${cmd} timed out after ${timeoutMs / 1000}s`));
        return;
      }
      if (code !== 0 && !resultText) {
        const stderr = Buffer.concat(errChunks).toString().trim();
        reject(
          new LLMCallError(
            `${cmd} exited with code ${code}: ${stderr || "(no output)"}`,
          ),
        );
        return;
      }
      resolve(resultText);
    });

    child.stdin.write(stdinData, () => {
      child.stdin.end();
    });
  });
}

// ---------------------------------------------------------------------------
// Provider interface & implementations
// ---------------------------------------------------------------------------

interface LLMProvider {
  name: string;
  /** Whether this provider can use tools (file read/write) to self-correct output. */
  supportsTools: boolean;
  isAvailable(): boolean;
  generate(
    systemPrompt: string,
    userMessage: string,
    model: string,
    onProgress?: (event: ProgressEvent) => void,
  ): Promise<string>;
}

function commandExists(cmd: string): boolean {
  try {
    execFileSync("which", [cmd], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

const claudeCodeProvider: LLMProvider = {
  name: "Claude Code CLI",
  supportsTools: true,

  isAvailable() {
    return commandExists("claude");
  },

  async generate(systemPrompt, userMessage, model, onProgress) {
    // Write system prompt to a temp file to avoid arg length limits.
    // User message goes via stdin using async spawn to handle large data.
    const tmpFile = path.join(os.tmpdir(), `diagram-docs-sysprompt-${Date.now()}.txt`);
    fs.writeFileSync(tmpFile, systemPrompt, "utf-8");
    try {
      return await spawnStreamJson(
        "claude",
        [
          "-p",
          "--verbose",
          "--output-format", "stream-json",
          "--include-partial-messages",
          "--system-prompt-file", tmpFile,
          "--model", model,
          "--allowedTools", "Write", "Read", "Edit",
        ],
        userMessage,
        600_000, // 10 minutes
        onProgress,
      );
    } finally {
      try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
    }
  },
};

const copilotProvider: LLMProvider = {
  name: "GitHub Copilot CLI",
  supportsTools: false,

  isAvailable() {
    if (!commandExists("gh")) return false;
    try {
      execFileSync("gh", ["copilot", "--version"], { stdio: "pipe" });
      return true;
    } catch {
      return false;
    }
  },

  async generate(systemPrompt, userMessage, _model, _onProgress) {
    // Copilot CLI doesn't support --system-prompt or streaming, so combine into one prompt via stdin
    const combinedPrompt = `${systemPrompt}\n\n---\n\n${userMessage}`;
    return spawnWithStdin("gh", ["copilot", "-p", combinedPrompt], "", 600_000);
  },
};

const providers: LLMProvider[] = [claudeCodeProvider, copilotProvider];

// ---------------------------------------------------------------------------
// Prompt construction
// ---------------------------------------------------------------------------

function buildSystemPrompt(outputPath?: string): string {
  const outputInstruction = outputPath
    ? `Write the YAML to: ${outputPath}
After writing, read the file back and verify the YAML parses correctly and conforms to the schema below. Fix any issues you find — do not stop until the file contains valid YAML.`
    : "Output ONLY valid YAML — no markdown fences, no explanatory text.";

  return `You are an architecture modeling agent. Given a codebase scan (raw-structure.json), produce an architecture-model.yaml for C4 diagram generation.

${outputInstruction}

## Output Schema

version: 1
system:
  name: "string"                    # Human-readable system name
  description: "string"             # What the system does (1-2 sentences)
actors:
  - id: "kebab-case-id"
    name: "Human Name"
    description: "What this actor does"
externalSystems:
  - id: "kebab-case-id"
    name: "Human Name"
    description: "What this system provides"
    technology: "e.g. PostgreSQL, SMTP, REST API"
containers:
  - id: "kebab-case-id"
    applicationId: "string"         # Must match ScannedApplication.id from scan
    name: "Human Name"
    description: "What this container does (1-2 sentences)"
    technology: "e.g. Java / Spring Boot"
    path: "relative/path"
components:
  - id: "kebab-case-id"
    containerId: "string"           # Must reference a container.id
    name: "Human Name"
    description: "What this component does"
    technology: "e.g. Spring MVC, JPA Entity"
    moduleIds:
      - "module-id"                 # Must reference ScannedModule.id values from scan
relationships:
  - sourceId: "string"
    targetId: "string"
    label: "Verb phrase"            # e.g. "Reads events from", "Authenticates via"
    technology: "string"            # Optional, e.g. "HTTPS", "JDBC"

## Rules

### IDs
- All IDs use kebab-case (lowercase, hyphens).
- Container applicationId must exactly match a ScannedApplication.id from the scan.
- Component moduleIds must exactly reference ScannedModule.id values. Every module should appear in exactly one component's moduleIds list.
- Relationship sourceId and targetId must reference valid ids defined in this model.

### Containers
- One container per scanned application. Skip shell parent apps (0 modules whose path is a prefix of another app's path).
- Infer technology from language + externalDependencies (e.g., Java + spring-boot-starter-web → "Java / Spring Boot").

### Components
- Group modules into meaningful architectural components, not 1:1 with modules.
- Use module metadata (annotations like Controller, Service, Repository, Entity) to identify roles.
- Aim for 5-15 components per container.

### Actors
- Infer from code structure:
  - REST controllers / HTTP endpoints → "User" or API consumer
  - Message consumers (Kafka, RabbitMQ) → upstream system actor
  - Scheduled jobs / CLI → may not need an actor
- Only include actors with evidence. Don't fabricate.

### External Systems
- Check externalDependencies for databases, message brokers, caches:
  - postgresql/mysql/oracle/h2 → Database
  - spring-kafka/kafka-clients → Apache Kafka
  - spring-data-redis/jedis/lettuce → Redis
  - elasticsearch/opensearch → Search engine
- Check configFiles for connection strings and service URLs.
- Include any externalSystems declared in the config.

### Relationships
- Every relationship needs a specific, descriptive label — never just "Uses".
  - Good: "Reads user profiles from", "Publishes order events to"
  - Bad: "Uses", "Calls", "Connects to"
- Derive from: internalImports, module imports, externalDependencies, configFiles.
- Include both container-level and component-level relationships.
- Include technology where known (JDBC, HTTP/REST, gRPC, Kafka).

### Descriptions
- System: what it does for users, not how it's built.
- Containers: what this unit is responsible for in the larger system.
- Components: what this grouping handles. Reference specific domain concerns.
- Don't be generic. "handles user-related operations" is worthless. "manages user registration, authentication, and profile management" is useful.

### Seed Mode (when deterministic seed is provided)
A machine-generated scaffold is provided. IDs and module mappings are already correct. Your job:
- Rewrite all descriptions to be specific and meaningful (remove generic "X module" placeholders).
- Regroup components by architectural role (Controller, Service, Repository, Entity, etc.) rather than the 1:1 module mapping. Aim for 5-15 components per container.
- Infer actors from code evidence (REST controllers → User, message consumers → upstream system).
- Detect external systems from externalDependencies and configFiles (databases, brokers, caches).
- Replace all "Uses" relationship labels with specific verb phrases ("Reads user profiles from", "Publishes events to").
- Add technology to relationships where known (JDBC, HTTP/REST, Kafka).
- Keep all applicationId and moduleId references valid — every module must appear in exactly one component.

### Update Mode (when existing human-edited model is provided)
- Preserve manual edits that look hand-written.
- Add new elements from scan not in the model.
- Remove stale elements whose IDs no longer appear in the scan.
- Re-derive relationships from current scan. Keep manually-added ones unless referenced elements are gone.`;
}

/**
 * Create a lean version of raw-structure for LLM consumption.
 * Strips verbose fields (files[], detailed imports) to fit context windows.
 */
function summarizeForLLM(rawStructure: RawStructure): unknown {
  return {
    version: rawStructure.version,
    applications: rawStructure.applications.map((app) => ({
      id: app.id,
      path: app.path,
      name: app.name,
      language: app.language,
      modules: app.modules.map((mod) => {
        const annotations = mod.metadata["annotations"];
        return {
          id: mod.id,
          name: mod.name,
          ...(annotations ? { annotations } : {}),
        };
      }),
      externalDependencies: app.externalDependencies.map((d) => d.name),
      internalImports: app.internalImports,
      ...(app.publishedAs ? { publishedAs: app.publishedAs } : {}),
      ...(app.configFiles?.length ? { configFiles: app.configFiles } : {}),
    })),
  };
}

export function buildUserMessage(options: {
  rawStructure: RawStructure;
  configYaml?: string;
  existingModelYaml?: string;
  isSeedMode?: boolean;
  outputPath?: string;
}): string {
  const parts: string[] = [];

  parts.push("## raw-structure.json\n");
  parts.push(JSON.stringify(summarizeForLLM(options.rawStructure)));

  if (options.configYaml) {
    parts.push("\n\n## diagram-docs.yaml\n");
    parts.push(options.configYaml);
  }

  if (options.existingModelYaml) {
    const label = options.isSeedMode
      ? "Deterministic seed (seed mode — reshape freely)"
      : "Existing architecture-model.yaml (update mode — preserve manual edits)";
    parts.push(`\n\n## ${label}\n`);
    parts.push(options.existingModelYaml);
  }

  if (options.outputPath) {
    parts.push(
      `\n\nWrite the architecture-model.yaml to: ${options.outputPath}\n` +
        "After writing, read it back and verify the YAML is valid and conforms to the schema. Fix any issues.",
    );
  } else {
    parts.push(
      "\n\nProduce the architecture-model.yaml content. Output ONLY the YAML — no markdown fences, no explanatory text before or after.",
    );
  }

  return parts.join("");
}

// ---------------------------------------------------------------------------
// YAML repair for common LLM output issues
// ---------------------------------------------------------------------------

/**
 * Attempt to repair malformed YAML from LLM output.
 *
 * Common issues:
 * 1. Truncated output — the LLM hit a token limit mid-line, leaving an
 *    unclosed quote or incomplete list item at the end.
 * 2. Smashed list items — two YAML list items on a single line, e.g.
 *    `      - "foo-      - "bar-baz"` (the LLM wrapped mid-token).
 */
export function repairLLMYaml(yaml: string): string {
  const lines = yaml.split("\n");
  const repaired: string[] = [];

  for (const line of lines) {
    // Detect smashed list items: multiple `- "value"` items on a single line.
    // The LLM sometimes concatenates list items when wrapping long output.
    // E.g.: `      - "mod-one"      - "mod-two"`
    const indent = line.match(/^(\s*)/)?.[1] ?? "";
    const items = [...line.matchAll(/-\s+"[^"]*"/g)];
    if (items.length > 1) {
      for (const m of items) {
        repaired.push(indent + m[0]);
      }
      continue;
    }

    // Also handle the case where the first item's quote is unclosed because
    // the LLM started a new list item mid-string:
    // `      - "los-      - "los-charging-infrastructure-dynamodb"`
    const smashedUnquoted = line.match(
      /^(\s*)-\s+"[^"]*\s{2,}(-\s+"[^"]*")/,
    );
    if (smashedUnquoted) {
      // Drop the broken first item, keep the second (which has a closing quote)
      repaired.push(indent + smashedUnquoted[2]);
      continue;
    }

    repaired.push(line);
  }

  // Handle truncated output: if the last non-empty line has an unclosed
  // quote or is an incomplete list item, remove trailing broken lines
  // until we reach a structurally complete line.
  while (repaired.length > 0) {
    const last = repaired[repaired.length - 1];
    const trimmed = last.trim();
    if (!trimmed) {
      repaired.pop();
      continue;
    }
    // Count quotes — odd number means unclosed string
    const quoteCount = (trimmed.match(/"/g) || []).length;
    if (quoteCount % 2 !== 0) {
      repaired.pop();
      continue;
    }
    // Incomplete list item (just a dash with no value, or trailing colon with no value
    // that isn't a mapping key introducing a block)
    if (/^-\s*$/.test(trimmed)) {
      repaired.pop();
      continue;
    }
    break;
  }

  return repaired.join("\n");
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export interface BuildModelWithLLMOptions {
  rawStructure: RawStructure;
  config: Config;
  configYaml?: string;
  existingModelYaml?: string;
  onStatus?: (status: string, providerName: string) => void;
  onProgress?: (event: ProgressEvent) => void;
}

export async function buildModelWithLLM(
  options: BuildModelWithLLMOptions,
): Promise<ArchitectureModel> {
  // 1. Resolve provider
  const configuredProvider = options.config.llm.provider;
  let provider: LLMProvider | undefined;

  if (configuredProvider === "auto") {
    provider = providers.find((p) => p.isAvailable());
  } else {
    const providerMap: Record<string, LLMProvider> = {
      "claude-code": claudeCodeProvider,
      copilot: copilotProvider,
    };
    provider = providerMap[configuredProvider];
    if (provider && !provider.isAvailable()) {
      throw new LLMUnavailableError(
        `Configured LLM provider "${configuredProvider}" is not available.\n` +
          `Ensure the CLI is installed and authenticated.`,
      );
    }
  }

  if (!provider) {
    throw new LLMUnavailableError(
      "No LLM provider found.\n\n" +
        "To generate a high-quality architecture model, install one of:\n" +
        "  - Claude Code CLI:    https://claude.ai/download\n" +
        "  - GitHub Copilot CLI: gh extension install github/gh-copilot\n\n" +
        "Or use the deterministic builder:\n" +
        "  diagram-docs generate --deterministic",
    );
  }

  const emit = (status: string) => options.onStatus?.(status, provider!.name);

  // 2. Build prompt — tool-using providers write to a temp file and self-validate
  emit("Building prompt...");

  // Generate a deterministic seed so the LLM refines rather than creates from scratch.
  // Skip if the caller already provided an existing model (real update mode).
  const isSeedMode = !options.existingModelYaml;
  let existingModelYaml = options.existingModelYaml;
  if (isSeedMode) {
    const seed = buildModel({ config: options.config, rawStructure: options.rawStructure });
    existingModelYaml = stringifyYaml(seed, { lineWidth: 120 });
  }

  const outputPath = provider.supportsTools
    ? path.join(os.tmpdir(), `diagram-docs-model-${Date.now()}.yaml`)
    : undefined;
  const systemPrompt = buildSystemPrompt(outputPath);
  const userMessage = buildUserMessage({
    rawStructure: options.rawStructure,
    configYaml: options.configYaml,
    existingModelYaml,
    isSeedMode,
    outputPath,
  });

  // 3. Call LLM
  emit(`Waiting for ${provider.name} response...`);
  const textOutput = await provider.generate(
    systemPrompt,
    userMessage,
    options.config.llm.model,
    options.onProgress,
  );

  // 4. Read output — prefer the file written by the agent, fall back to text output
  emit("Validating output...");
  let rawOutput: string;
  if (outputPath && fs.existsSync(outputPath)) {
    try {
      rawOutput = fs.readFileSync(outputPath, "utf-8");
    } finally {
      try { fs.unlinkSync(outputPath); } catch { /* ignore */ }
    }
  } else {
    rawOutput = textOutput;
  }

  // 5. Clean up output: strip markdown fences, preamble, and YAML comments
  rawOutput = rawOutput
    .trim()
    .replace(/^```ya?ml\s*\n?/i, "")
    .replace(/\n?```\s*$/i, "");

  // If the output doesn't start with valid YAML, try to find where it begins.
  // The LLM sometimes produces explanatory text before the YAML.
  if (!rawOutput.startsWith("version:") && !rawOutput.startsWith("---")) {
    const yamlStart = rawOutput.indexOf("\nversion:");
    if (yamlStart !== -1) {
      rawOutput = rawOutput.slice(yamlStart + 1);
    }
  }

  // 6. Repair common LLM YAML issues (safety net for text output path)
  rawOutput = repairLLMYaml(rawOutput);

  let parsed: unknown;
  try {
    parsed = parseYaml(rawOutput);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new LLMOutputError(
      `Failed to parse LLM output as YAML: ${msg}`,
      rawOutput.slice(0, 500),
    );
  }

  try {
    return architectureModelSchema.parse(parsed) as ArchitectureModel;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new LLMOutputError(
      `LLM output failed schema validation: ${msg}`,
      rawOutput.slice(0, 500),
    );
  }
}

/**
 * Serialize an ArchitectureModel to YAML with a header comment.
 */
export function serializeModel(model: ArchitectureModel): string {
  return (
    "# Architecture Model — generated by diagram-docs (LLM)\n" +
    "# Edit this file to refine names, descriptions, and relationships.\n" +
    "# Delete this file and re-run generate to regenerate via LLM.\n" +
    "\n" +
    stringifyYaml(model, { lineWidth: 120 })
  );
}
