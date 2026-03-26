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
import type { RawStructure, ScannedApplication, ArchitectureModel } from "../analyzers/types.js";
import { architectureModelSchema } from "./model.js";
import { buildModel } from "./model-builder.js";

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

export class LLMUnavailableError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "LLMUnavailableError";
  }
}

export class LLMCallError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "LLMCallError";
  }
}

export class LLMOutputError extends Error {
  public readonly rawOutput?: string;
  constructor(
    message: string,
    rawOutput?: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "LLMOutputError";
    this.rawOutput = rawOutput !== undefined && rawOutput.length > 500
      ? rawOutput.slice(0, 500) + `\n... (${rawOutput.length - 500} more chars truncated)`
      : rawOutput;
  }
}

// ---------------------------------------------------------------------------
// Error classification
// ---------------------------------------------------------------------------

/**
 * Returns true for native JS programming errors that should never be
 * caught and silently swallowed — they indicate bugs in the code.
 *
 * Note: SyntaxError is included here because it is a native JS programming
 * error. The YAML library throws YAMLParseError (not SyntaxError), and those
 * MUST be caught and wrapped into LLMOutputError in an inner try block before
 * they can reach any outer catch that calls this function.
 */
export function isProgrammingError(err: unknown): boolean {
  return (
    err instanceof TypeError ||
    err instanceof RangeError ||
    err instanceof ReferenceError ||
    err instanceof SyntaxError ||
    err instanceof URIError ||
    err instanceof EvalError
  );
}

/** System-level error codes that indicate resource exhaustion, not LLM issues. */
const SYSTEM_ERROR_CODES = new Set(["ENOMEM", "ENOSPC", "EMFILE", "ENFILE"]);

/**
 * Returns true for OS-level resource errors that should propagate rather
 * than be wrapped as recoverable LLM errors.
 */
export function isSystemResourceError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const code = (err as NodeJS.ErrnoException).code;
  return typeof code === "string" && SYSTEM_ERROR_CODES.has(code);
}

/**
 * Rethrow errors that indicate programming bugs or system resource exhaustion.
 * Use in catch blocks to ensure these errors always propagate.
 */
export function rethrowIfFatal(err: unknown): void {
  if (isProgrammingError(err)) throw err;
  if (isSystemResourceError(err)) throw err;
}

/**
 * Returns true for errors that indicate a recoverable LLM/output failure
 * (provider errors, bad output). All YAML/Zod errors from LLM output are
 * wrapped in LLMOutputError before reaching the outer catch; a raw
 * YAMLParseError or ZodError escaping would indicate a missing wrapper
 * and should propagate as a bug.
 */
export function isRecoverableLLMError(err: unknown): boolean {
  return (
    err instanceof LLMCallError ||
    err instanceof LLMOutputError
  );
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
    let settled = false;
    let epipeSeen = false;
    let stderrBuf = "";

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGTERM");
      reject(new LLMCallError(`${cmd} timed out after ${timeoutMs / 1000}s`));
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
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new LLMCallError(`Failed to spawn ${cmd}: ${err.message}`));
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
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
      if (epipeSeen) {
        const warning = `Warning: child process (${cmd}) did not consume full stdin (EPIPE) — output may be based on truncated input`;
        onStderr?.(warning);
      }
      resolve(Buffer.concat(chunks).toString("utf-8"));
    });

    // EPIPE is expected when the child exits before consuming all stdin.
    // If the child exits non-zero, the close handler reports the real failure.
    // If it exits successfully, we warn that the output may be based on truncated input.
    child.stdin.on("error", (err) => {
      if ((err as NodeJS.ErrnoException).code === "EPIPE") {
        epipeSeen = true;
        const warning = `Warning: EPIPE writing to ${cmd} stdin — child may not have consumed full input`;
        if (onStderr) {
          onStderr(warning);
        } else {
          try { process.stderr.write(`${warning}\n`); } catch (e) { if (isProgrammingError(e)) throw e; }
        }
        return;
      }
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(new LLMCallError(`Failed to write to ${cmd} stdin: ${err.message}`));
      } else {
        onStderr?.(`Warning: late stdin error for ${cmd}: ${err.message}`);
      }
    });
    child.stdin.write(stdinData, (err) => {
      if (err) return; // error event handler will fire separately
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
  readonly line: string;
  /** true when this line is complete (a newline was seen); false while still being built */
  readonly final: boolean;
  /** "thinking" for internal reasoning, "output" for actual generated content */
  readonly kind: "thinking" | "output";
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
    let settled = false;
    let epipeSeen = false;
    let syntaxErrors = 0;
    let totalSyntaxErrors = 0;
    let firstBadLine = "";

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGTERM");
      reject(new LLMCallError(
        `${cmd} timed out after ${timeoutMs / 1000}s` +
          (resultText ? ` (${resultText.length} chars of partial output were received)` : ""),
      ));
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      if (settled) return;
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
              // New line(s) started → push all completed lines as finished
              if (lines.length > lastTextLineCount) {
                for (let li = lastTextLineCount - 1; li < lines.length - 1; li++) {
                  const completed = lines[li]?.trim();
                  if (completed) onProgress({ line: completed, final: true, kind: "output" });
                }
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
                for (let li = lastThinkLineCount - 1; li < lines.length - 1; li++) {
                  const completed = lines[li]?.trim();
                  if (completed) onProgress({ line: completed, final: true, kind: "thinking" });
                }
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
          syntaxErrors = 0;
        } catch (err) {
          if (!(err instanceof SyntaxError)) {
            settled = true;
            clearTimeout(timer);
            const msg = err instanceof Error ? err.message : String(err);
            const stack = err instanceof Error ? `\n${err.stack}` : "";
            reject(new LLMCallError(
              `Unexpected error parsing ${cmd} output: ${msg}\n` +
                `Offending line: ${line.slice(0, 200)}${stack}`,
            ));
            try { child.kill("SIGTERM"); } catch { /* best-effort — promise already rejected */ }
            return;
          }
          syntaxErrors++;
          totalSyntaxErrors++;
          if (totalSyntaxErrors === 1) firstBadLine = line;
          // Emit progressive warnings so the user sees accumulating failures
          if (totalSyntaxErrors === 1 || totalSyntaxErrors === 10 || totalSyntaxErrors === 50) {
            const warn = `Warning: ${totalSyntaxErrors} unparseable JSON line(s) from ${cmd} so far`;
            if (onProgress) {
              onProgress({ line: warn, final: true, kind: "thinking" });
            } else {
              try { process.stderr.write(`${warn}\n`); } catch { /* best-effort */ }
            }
          }
          if (syntaxErrors >= 100 || totalSyntaxErrors >= 500) {
            settled = true;
            clearTimeout(timer);
            reject(new LLMCallError(
              `${cmd} produced ${totalSyntaxErrors} unparseable JSON lines ` +
                `(${syntaxErrors} consecutive) — aborting. ` +
                `First bad line: ${firstBadLine.slice(0, 200)}`,
            ));
            try { child.kill("SIGTERM"); } catch { /* best-effort — promise already rejected */ }
            return;
          }
        }
      }
    });

    child.stderr.on("data", (chunk) => errChunks.push(chunk));

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new LLMCallError(`Failed to spawn ${cmd}: ${err.message}`));
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      if (code !== 0) {
        const stderr = Buffer.concat(errChunks).toString().trim();
        const context = resultText
          ? ` (${resultText.length} chars of partial output were received)`
          : "";
        reject(
          new LLMCallError(
            `${cmd} exited with code ${code}: ${stderr || "(no output)"}${context}`,
          ),
        );
        return;
      }
      if (!resultText && totalSyntaxErrors > 0) {
        reject(
          new LLMCallError(
            `${cmd} produced ${totalSyntaxErrors} unparseable JSON line(s) and no usable output. ` +
              `First bad line: ${firstBadLine.slice(0, 200)}`,
          ),
        );
        return;
      }
      if (!resultText) {
        reject(
          new LLMCallError(
            `${cmd} exited successfully but produced no output`,
          ),
        );
        return;
      }
      if (epipeSeen) {
        const warning = `Warning: child process (${cmd}) did not consume full stdin (EPIPE) — output may be based on truncated input`;
        if (onProgress) {
          onProgress({ line: warning, final: true, kind: "thinking" });
        } else {
          try { process.stderr.write(`${warning}\n`); } catch (e) { if (isProgrammingError(e)) throw e; }
        }
      }
      if (totalSyntaxErrors > 0) {
        const msg = `Warning: ${totalSyntaxErrors} unparseable JSON line(s) from ${cmd} were skipped`;
        if (onProgress) {
          onProgress({ line: msg, final: true, kind: "thinking" });
        } else {
          try { process.stderr.write(`${msg}\n`); } catch (e) { if (isProgrammingError(e)) throw e; }
        }
      }
      resolve(resultText);
    });

    // EPIPE is expected when the child exits before consuming all stdin.
    // If the child exits non-zero, the close handler reports the real failure.
    // If it exits successfully, we warn that the output may be based on truncated input.
    child.stdin.on("error", (err) => {
      if ((err as NodeJS.ErrnoException).code === "EPIPE") {
        epipeSeen = true;
        const warning = `Warning: EPIPE writing to ${cmd} stdin — child may not have consumed full input`;
        if (onProgress) {
          onProgress({ line: warning, final: true, kind: "thinking" });
        } else {
          try { process.stderr.write(`${warning}\n`); } catch (e) { if (isProgrammingError(e)) throw e; }
        }
        return;
      }
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(new LLMCallError(`Failed to write to ${cmd} stdin: ${err.message}`));
      } else {
        onProgress?.({ line: `Warning: late stdin error for ${cmd}: ${err.message}`, final: true, kind: "thinking" });
      }
    });
    child.stdin.write(stdinData, (err) => {
      if (err) return; // error event handler will fire separately
      child.stdin.end();
    });
  });
}

// ---------------------------------------------------------------------------
// Provider interface & implementations
// ---------------------------------------------------------------------------

export interface LLMProvider {
  readonly name: string;
  /** Whether this provider can use tools (file read/write) to self-correct output. */
  readonly supportsTools: boolean;
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
  } catch (err: unknown) {
    rethrowIfFatal(err);
    // `which` exiting non-zero means the command was not found — expected.
    if (err instanceof Error && "status" in err && typeof (err as { status: unknown }).status === "number") {
      return false;
    }
    const msg = err instanceof Error ? err.message : String(err);
    throw new LLMCallError(`Failed to check if ${cmd} exists: ${msg}`, { cause: err });
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
    try {
      fs.writeFileSync(tmpFile, systemPrompt, "utf-8");
    } catch (err: unknown) {
      rethrowIfFatal(err);
      const msg = err instanceof Error ? err.message : String(err);
      throw new LLMCallError(`Failed to write system prompt to temp file: ${msg}`, { cause: err });
    }
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
        900_000, // 15 minutes
        onProgress,
      );
    } finally {
      try {
        fs.unlinkSync(tmpFile);
      } catch (e) {
        rethrowIfFatal(e);
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
          const warning = `Failed to clean up temp file ${tmpFile}: ${(e as Error).message}`;
          if (onProgress) {
            onProgress({ line: warning, final: true, kind: "thinking" });
          } else {
            try { process.stderr.write(`${warning}\n`); } catch (e) { if (isProgrammingError(e)) throw e; }
          }
        }
      }
    }
  },
};

/** Patterns in `gh copilot` stderr that are diagnostic noise, not errors. */
const COPILOT_STDERR_NOISE = [
  /^Total usage est:/,
  /^API time spent:/,
  /^Total session time:/,
  /^Total code changes:/,
  /^Breakdown by AI model:/,
  /^claude-/,
  /^gpt-/,
  /^Only built-in servers are available/,
  /Third-party MCP servers are disabled/,
  /^Warning: EPIPE writing to gh stdin/,
  /^Warning: child process \(gh\) did not consume full stdin/,
];

function isCopilotStderrNoise(line: string): boolean {
  return COPILOT_STDERR_NOISE.some((re) => re.test(line));
}

const copilotProvider: LLMProvider = {
  name: "GitHub Copilot CLI",
  supportsTools: false,

  isAvailable() {
    if (!commandExists("gh")) return false;
    try {
      execFileSync("gh", ["copilot", "--version"], { stdio: "pipe" });
      return true;
    } catch (err: unknown) {
      rethrowIfFatal(err);
      // Non-zero exit means the copilot extension is not installed — expected.
      if (err instanceof Error && "status" in err && typeof (err as { status: unknown }).status === "number") {
        return false;
      }
      const msg = err instanceof Error ? err.message : String(err);
      throw new LLMCallError(`Failed to check copilot availability: ${msg}`, { cause: err });
    }
  },

  async generate(systemPrompt, userMessage, _model, onProgress) {
    // Copilot CLI doesn't support --system-prompt or streaming, so combine into one prompt.
    // Pass via stdin to avoid OS argument length limits on large codebases.
    const combinedPrompt = `${systemPrompt}\n\n---\n\n${userMessage}`;
    return spawnWithStdin(
      "gh", ["copilot", "-p", "-"], combinedPrompt, 900_000,
      onProgress ? (line) => {
        if (!isCopilotStderrNoise(line)) {
          onProgress({ line, final: true, kind: "output" });
        }
      } : undefined,
    );
  },
};

const providers: LLMProvider[] = [claudeCodeProvider, copilotProvider];

// ---------------------------------------------------------------------------
// Provider resolution
// ---------------------------------------------------------------------------

export function resolveProvider(config: Config): LLMProvider {
  const configuredProvider = config.llm.provider;
  let provider: LLMProvider | undefined;

  if (configuredProvider === "auto") {
    provider = providers.find((p) => p.isAvailable());
  } else {
    const providerMap: Record<string, LLMProvider> = {
      "claude-code": claudeCodeProvider,
      copilot: copilotProvider,
    };
    provider = providerMap[configuredProvider];
    if (!provider) {
      throw new LLMUnavailableError(
        `Unknown LLM provider "${configuredProvider}". ` +
          `Valid providers are: ${Object.keys(providerMap).join(", ")}`,
      );
    }
    if (!provider.isAvailable()) {
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

  return provider;
}

// ---------------------------------------------------------------------------
// Prompt construction
// ---------------------------------------------------------------------------

export function buildSystemPrompt(outputPath?: string): string {
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
 * Strips verbose per-module fields (files, exports, imports, non-annotation metadata) to fit context windows.
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
// Per-app and synthesis prompt builders
// ---------------------------------------------------------------------------

export function buildPerAppSystemPrompt(outputPath?: string): string {
  const base = buildSystemPrompt(outputPath);
  return base + `\n\n### Single-App Mode
You are modeling a SINGLE APPLICATION within a larger multi-app system.
- Focus only on this application's internal architecture.
- Do NOT produce cross-container relationships. These are handled separately.
- The internalImports field is provided for context only (to inform descriptions). Do not create relationships from it.
- Produce: containers (just this one), components, intra-app relationships, actors, externalSystems relevant to this app.`;
}

export function buildPerAppUserMessage(options: {
  app: ScannedApplication;
  configYaml?: string;
  seedYaml: string;
  outputPath?: string;
}): string {
  // Build single-app raw structure summary (same format as summarizeForLLM but for one app)
  const singleAppStructure = {
    version: 1,
    applications: [{
      id: options.app.id,
      path: options.app.path,
      name: options.app.name,
      language: options.app.language,
      modules: options.app.modules.map((mod) => {
        const annotations = mod.metadata["annotations"];
        return {
          id: mod.id,
          name: mod.name,
          ...(annotations ? { annotations } : {}),
        };
      }),
      externalDependencies: options.app.externalDependencies.map((d) => d.name),
      internalImports: options.app.internalImports,
      ...(options.app.publishedAs ? { publishedAs: options.app.publishedAs } : {}),
      ...(options.app.configFiles?.length ? { configFiles: options.app.configFiles } : {}),
    }],
  };

  const parts: string[] = [];
  parts.push("## raw-structure.json\n");
  parts.push(JSON.stringify(singleAppStructure));

  if (options.configYaml) {
    parts.push("\n\n## diagram-docs.yaml\n");
    parts.push(options.configYaml);
  }

  parts.push(`\n\n## Deterministic seed (seed mode — reshape freely)\n`);
  parts.push(options.seedYaml);

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

export function buildSynthesisSystemPrompt(): string {
  return `You are an architecture synthesis agent. You are given the results of per-application architecture modeling and need to produce a unified system-level view.

## Your Job
1. Write a meaningful system name and description (what the system does for users, not how it's built).
2. Refine cross-app relationship labels from generic "Uses"/"Calls" to specific verb phrases (e.g., "Reads user profiles from", "Publishes order events to").
3. Consolidate actors — merge duplicates, improve descriptions.
4. Consolidate external systems — merge duplicates, improve descriptions.

## Output
Output ONLY valid YAML with this structure:
system:
  name: "string"
  description: "string"
actors:
  - id: "kebab-case"
    name: "Human Name"
    description: "What this actor does"
externalSystems:
  - id: "kebab-case"
    name: "Human Name"
    description: "What this system provides"
    technology: "e.g. PostgreSQL"
relationships:
  - sourceId: "string"
    targetId: "string"
    label: "Specific verb phrase"
    technology: "optional"

Only include relationships that were provided to you. Do not invent new ones. Refine labels only.`;
}

export function buildSynthesisUserMessage(options: {
  containers: Array<{ id: string; name: string; description: string; technology: string }>;
  actors: ArchitectureModel["actors"];
  externalSystems: ArchitectureModel["externalSystems"];
  crossAppRelationships: ArchitectureModel["relationships"];
}): string {
  const parts: string[] = [];
  parts.push("## Containers\n");
  parts.push(JSON.stringify(options.containers, null, 2));
  parts.push("\n\n## Current Actors\n");
  parts.push(JSON.stringify(options.actors, null, 2));
  parts.push("\n\n## Current External Systems\n");
  parts.push(JSON.stringify(options.externalSystems, null, 2));
  parts.push("\n\n## Cross-App Relationships (refine labels)\n");
  parts.push(JSON.stringify(options.crossAppRelationships, null, 2));
  return parts.join("");
}

// ---------------------------------------------------------------------------
// YAML repair for common LLM output issues
// ---------------------------------------------------------------------------

/** Result of YAML repair, including the corrected text and repair statistics. */
export interface RepairResult {
  /** The YAML string after all repairs have been applied. */
  readonly yaml: string;
  /** Number of input lines that contained smashed list items and were expanded or corrected. */
  readonly linesSplit: number;
  /** Number of trailing structurally broken lines that were removed. */
  readonly linesRemoved: number;
  /** Content of lines that were removed during trailing-truncation repair. */
  readonly removedLines: readonly string[];
}

/**
 * Attempt to repair malformed YAML from LLM output.
 *
 * Common issues:
 * 1. Truncated output — the LLM hit a token limit mid-line, leaving an
 *    unclosed quote or incomplete list item at the end.
 * 2. Smashed list items — two YAML list items on a single line, e.g.
 *    `      - "foo-      - "bar-baz"` (the LLM wrapped mid-token).
 */

export function repairLLMYaml(yaml: string): RepairResult {
  const lines = yaml.split("\n");
  const repaired: string[] = [];
  const removedLines: string[] = [];
  let linesSplit = 0;
  let linesRemoved = 0;

  for (const line of lines) {
    // Detect smashed list items: multiple `- "value"` items on a single line.
    // The LLM sometimes concatenates list items when wrapping long output.
    // E.g.: `      - "mod-one"      - "mod-two"`
    const indent = line.match(/^(\s*)/)?.[1] ?? "";
    const isListItem = /^\s*-\s/.test(line);
    const items = isListItem ? [...line.matchAll(/-\s+"[^"]*"/g)] : [];
    if (items.length > 1) {
      for (const m of items) {
        repaired.push(indent + m[0]);
      }
      linesSplit++;
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
      linesSplit++;
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
      removedLines.push(repaired.pop()!);
      linesRemoved++;
      continue;
    }
    // Count quotes — odd number means unclosed string
    const quoteCount = (trimmed.match(/"/g) || []).length;
    if (quoteCount % 2 !== 0) {
      removedLines.push(repaired.pop()!);
      linesRemoved++;
      continue;
    }
    // Incomplete list item (just a dash with no value)
    if (/^-\s*$/.test(trimmed)) {
      removedLines.push(repaired.pop()!);
      linesRemoved++;
      continue;
    }
    break;
  }

  return { yaml: repaired.join("\n"), linesSplit, linesRemoved, removedLines };
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export interface BuildModelWithLLMOptions {
  readonly rawStructure: RawStructure;
  readonly config: Config;
  readonly configYaml?: string;
  readonly existingModelYaml?: string;
  readonly onStatus?: (status: string, providerName: string) => void;
  readonly onProgress?: (event: ProgressEvent) => void;
}

export async function buildModelWithLLM(
  options: BuildModelWithLLMOptions,
): Promise<ArchitectureModel> {
  // 1. Resolve provider
  const resolvedProvider = resolveProvider(options.config);
  const emit = (status: string) => options.onStatus?.(status, resolvedProvider.name);

  // Parallel path: seed mode dispatches per-app LLM calls concurrently (even for a single app)
  const isSeedMode = !options.existingModelYaml?.trim();
  if (isSeedMode) {
    // Dynamic import is separated from the call so module resolution
    // errors are not accidentally wrapped as LLMCallError.
    let buildModelParallel: typeof import("./parallel-model-builder.js")["buildModelParallel"];
    try {
      ({ buildModelParallel } = await import("./parallel-model-builder.js"));
    } catch (err) {
      rethrowIfFatal(err);
      throw new LLMCallError(
        `Failed to load parallel model builder module: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      );
    }
    try {
      return await buildModelParallel({
        rawStructure: options.rawStructure,
        config: options.config,
        configYaml: options.configYaml,
        provider: resolvedProvider,
        onStatus: options.onStatus
          ? (status) => options.onStatus!(status, resolvedProvider.name)
          : undefined,
        onProgress: options.onProgress,
      });
    } catch (err) {
      if (err instanceof LLMCallError || err instanceof LLMOutputError || err instanceof LLMUnavailableError) throw err;
      rethrowIfFatal(err);
      throw new LLMCallError(
        `Parallel model builder failed: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      );
    }
  }

  // 2. Build prompt — tool-using providers write to a temp file and self-validate
  emit("Building prompt...");
  let existingModelYaml = options.existingModelYaml;
  if (isSeedMode) {
    try {
      const seed = buildModel({ config: options.config, rawStructure: options.rawStructure });
      existingModelYaml = stringifyYaml(seed, { lineWidth: 120 });
    } catch (err: unknown) {
      rethrowIfFatal(err);
      const msg = err instanceof Error ? err.message : String(err);
      throw new LLMCallError(`Failed to generate deterministic seed for LLM: ${msg}`, { cause: err });
    }
  }

  const outputPath = resolvedProvider.supportsTools
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
  emit(`Waiting for ${resolvedProvider.name} response...`);
  let textOutput: string;
  try {
    textOutput = await resolvedProvider.generate(
      systemPrompt,
      userMessage,
      options.config.llm.model,
      options.onProgress,
    );
  } catch (err) {
    if (outputPath) {
      try { fs.unlinkSync(outputPath); } catch (e) {
        rethrowIfFatal(e);
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
          const warning = `Failed to clean up temp file ${outputPath}: ${(e as Error).message}`;
          emit(warning);
        }
      }
    }
    throw err;
  }

  // 4. Read output — prefer the file written by the agent, fall back to text output
  emit("Validating output...");
  let rawOutput: string;
  if (outputPath && fs.existsSync(outputPath)) {
    try {
      rawOutput = fs.readFileSync(outputPath, "utf-8");
      if (!rawOutput.trim()) {
        if (textOutput.trim()) {
          const warning = "Warning: agent output file was empty, using text stream as fallback";
          emit(warning);
          if (!options.onStatus) process.stderr.write(`${warning}\n`);
          rawOutput = textOutput;
        } else {
          throw new LLMOutputError(
            "Agent wrote an empty output file and no text output was streamed",
          );
        }
      }
    } catch (err: unknown) {
      if (err instanceof LLMOutputError) throw err;
      rethrowIfFatal(err);
      const errCode = (err as NodeJS.ErrnoException).code;
      const msg = err instanceof Error ? err.message : String(err);
      // Only ENOENT (file vanished between existsSync and readFileSync) is safe for fallback.
      // All other filesystem errors indicate real system problems.
      if (errCode !== "ENOENT") {
        throw new LLMCallError(
          `System error reading agent output file: ${msg}`,
          { cause: err },
        );
      }
      if (!textOutput.trim()) {
        throw new LLMCallError(
          `Failed to read agent output file (${msg}) and no text output was streamed as fallback`,
          { cause: err },
        );
      }
      const warning = `Warning: failed to read agent output file (${errCode}), using text stream: ${msg}`;
      emit(warning);
      rawOutput = textOutput;
    } finally {
      try { fs.unlinkSync(outputPath); } catch (e) {
        rethrowIfFatal(e);
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
          const warning = `Failed to clean up temp file ${outputPath}: ${(e as Error).message}`;
          emit(warning);
        }
      }
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
      emit(`Stripped ${yamlStart} characters of preamble text before YAML`);
      rawOutput = rawOutput.slice(yamlStart + 1);
    }
  }

  // 6. Repair common LLM YAML issues (e.g., smashed list items, truncated trailing lines)
  const repair = repairLLMYaml(rawOutput);
  rawOutput = repair.yaml;
  if (repair.linesSplit > 0 || repair.linesRemoved > 0) {
    emit(
      `Repaired LLM YAML: ${repair.linesSplit} smashed lines split, ` +
        `${repair.linesRemoved} trailing broken lines removed.`,
    );
    if (repair.removedLines.length > 0) {
      emit(`Removed trailing lines:\n${repair.removedLines.join("\n")}`);
    }
  }

  if (!rawOutput.trim()) {
    throw new LLMOutputError(
      repair.linesRemoved > 0
        ? `LLM output was entirely malformed — all ${repair.linesRemoved} trailing broken lines were removed during repair`
        : "LLM output was empty — no usable content was found after cleanup",
      rawOutput,
    );
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(rawOutput);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new LLMOutputError(
      `Failed to parse LLM output as YAML: ${msg}`,
      rawOutput,
      { cause: err },
    );
  }

  try {
    return architectureModelSchema.parse(parsed) as ArchitectureModel;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new LLMOutputError(
      `LLM output failed schema validation: ${msg}`,
      rawOutput,
      { cause: err },
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
