import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import * as YAML from "yaml";
import { type Config, type FolderRole, roleEnum } from "../config/schema.js";
import type { FolderSignals } from "./classifier.js";

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

export interface AgentClassification {
  role: FolderRole;
  name: string;
  description: string;
  confidence: number;
  /**
   * True when the LLM call failed and the classification is a heuristic
   * fallback. Callers track this to surface a non-zero exit code — a run
   * that silently degraded to heuristics is not a successful run.
   */
  failed?: boolean;
}

export interface CacheEntry extends AgentClassification {
  signalHash: string;
}

/* ------------------------------------------------------------------ */
/*  Hashing                                                           */
/* ------------------------------------------------------------------ */

/**
 * Compute a stable 16-hex-char hash of the folder signals.
 * Used as a cache key to detect when signals change.
 */
export function computeSignalHash(signals: FolderSignals): string {
  const json = JSON.stringify(signals);
  const hash = crypto.createHash("sha256").update(json).digest("hex");
  return hash.slice(0, 16);
}

/* ------------------------------------------------------------------ */
/*  Cache persistence                                                 */
/* ------------------------------------------------------------------ */

function cachePath(rootDir: string): string {
  return path.join(rootDir, ".diagram-docs", "agent-cache.yaml");
}

/**
 * Load agent classification cache from `.diagram-docs/agent-cache.yaml`.
 */
export function loadAgentCache(rootDir: string): Map<string, CacheEntry> {
  const filePath = cachePath(rootDir);
  const map = new Map<string, CacheEntry>();
  if (!fs.existsSync(filePath)) return map;

  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = YAML.parse(raw) as Record<string, CacheEntry> | null;
    if (parsed && typeof parsed === "object") {
      for (const [key, entry] of Object.entries(parsed)) {
        // Validate cache entries to guard against corrupted YAML
        if (
          entry &&
          typeof entry === "object" &&
          VALID_ROLES.has((entry as CacheEntry).role) &&
          typeof (entry as CacheEntry).signalHash === "string"
        ) {
          map.set(key, entry as CacheEntry);
        }
      }
    }
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EMFILE" || code === "ENFILE" || code === "ENOMEM") {
      throw err;
    }
    // Preserve the user's paid-for LLM history: rename the corrupt file so
    // the user can inspect/recover it instead of silently deleting.
    const backupPath = `${filePath}.corrupt.${Date.now()}.bak`;
    try {
      fs.renameSync(filePath, backupPath);
      console.error(
        `Warning: agent cache at ${filePath} is corrupted, renamed to ${backupPath} and starting fresh: ${err instanceof Error ? err.message : err}`,
      );
    } catch (renameErr: unknown) {
      console.error(
        `Warning: agent cache at ${filePath} is corrupted but could not be renamed. Please move it manually. Original error: ${err instanceof Error ? err.message : err}. Rename error: ${renameErr instanceof Error ? renameErr.message : renameErr}`,
      );
    }
  }
  return map;
}

/**
 * Save agent classification cache to `.diagram-docs/agent-cache.yaml`.
 */
export function saveAgentCache(
  rootDir: string,
  cache: Map<string, CacheEntry>,
): void {
  try {
    const filePath = cachePath(rootDir);
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const obj: Record<string, CacheEntry> = {};
    for (const [key, entry] of cache) {
      obj[key] = entry;
    }
    // Atomic write: temp + rename. A crash mid-write would otherwise leave
    // the cache corrupted, forcing loadAgentCache to discard paid-for work.
    const tmpPath = `${filePath}.tmp.${process.pid}`;
    fs.writeFileSync(tmpPath, YAML.stringify(obj), "utf-8");
    fs.renameSync(tmpPath, filePath);
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EMFILE" || code === "ENFILE" || code === "ENOMEM" || code === "ENOSPC") {
      throw err;
    }
    console.error(
      `Warning: failed to save agent cache (LLM results will not be cached, incurring additional API costs): ${err instanceof Error ? err.message : err}`,
    );
  }
}

/* ------------------------------------------------------------------ */
/*  Response parsing                                                  */
/* ------------------------------------------------------------------ */

const VALID_ROLES = new Set<FolderRole>(roleEnum.options);

/**
 * Extract a JSON classification from the LLM response text.
 *
 * Returns null on JSON syntax errors (so the caller can fall back to a
 * heuristic); rethrows anything else (TypeError from a bad getter etc.)
 * since those indicate programming bugs.
 */
export function parseAgentResponse(text: string): AgentClassification | null {
  try {
    let cleaned = text.trim();
    const fenceMatch = cleaned.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
    if (fenceMatch) {
      cleaned = fenceMatch[1].trim();
    }

    const parsed = JSON.parse(cleaned) as Record<string, unknown>;

    if (!VALID_ROLES.has(parsed.role as FolderRole)) {
      console.error(
        `Warning: LLM returned unrecognized role "${parsed.role}", falling back to heuristic`,
      );
      return null;
    }
    const role = parsed.role as FolderRole;

    const name = typeof parsed.name === "string" ? parsed.name : "";
    const description =
      typeof parsed.description === "string" ? parsed.description : "";
    const confidence =
      typeof parsed.confidence === "number"
        ? Math.max(0, Math.min(1, parsed.confidence))
        : 0;

    return { role, name, description, confidence };
  } catch (err: unknown) {
    if (!(err instanceof SyntaxError)) throw err;
    console.error(
      `Warning: could not parse LLM classification response (${err.message}): ${text.slice(0, 200)}${text.length > 200 ? "..." : ""}`,
    );
    return null;
  }
}

/* ------------------------------------------------------------------ */
/*  Prompt building                                                   */
/* ------------------------------------------------------------------ */

function buildPrompt(
  folderPath: string,
  rootDir: string,
  signals: FolderSignals,
  heuristicRole: FolderRole,
  parentContext?: string,
): string {
  const relPath = path.relative(rootDir, folderPath) || ".";
  const lines: string[] = [
    "Classify this folder in a software project for C4 architecture diagramming.",
    "",
    `Folder: ${relPath}`,
    `Heuristic role: ${heuristicRole}`,
  ];

  if (parentContext) {
    lines.push(`Parent context: ${parentContext}`);
  }

  lines.push("", "Signals:");
  lines.push(`  Build files: ${signals.buildFiles.join(", ") || "none"}`);
  lines.push(`  Infra files: ${signals.infraFiles.join(", ") || "none"}`);
  lines.push(`  Source file count: ${signals.sourceFileCount}`);
  lines.push(`  Languages: ${signals.sourceLanguages.join(", ") || "none"}`);
  lines.push(`  Has package structure: ${signals.hasPackageStructure}`);
  lines.push(`  Is package dir: ${signals.isPackageDir}`);
  lines.push(`  Depth: ${signals.depth}`);
  lines.push(
    `  Children with build files: ${signals.childrenWithBuildFiles}`,
  );
  lines.push(
    `  Child folder names: ${signals.childFolderNames.join(", ") || "none"}`,
  );
  if (signals.readmeSnippet) {
    lines.push(`  README snippet: ${signals.readmeSnippet}`);
  }

  lines.push("");
  lines.push(
    'Respond with ONLY a JSON object: { "role": "system"|"container"|"component"|"code-only"|"skip", "name": "<human-readable name>", "description": "<one-sentence description>", "confidence": 0.0-1.0 }',
  );

  return lines.join("\n");
}

/* ------------------------------------------------------------------ */
/*  LLM calling                                                       */
/*                                                                    */
/*  Both SDKs are dynamic imports because they are optional peer deps */
/*  — users who run `--no-agent` should not need them installed.      */
/* ------------------------------------------------------------------ */

async function callAnthropic(
  prompt: string,
  model: string,
): Promise<string | null> {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic({ timeout: 15_000 });
  const response = await client.messages.create({
    model,
    max_tokens: 256,
    messages: [{ role: "user", content: prompt }],
  });
  const block = response.content[0];
  if (block?.type === "text") return block.text;
  console.error(
    `Warning: Anthropic returned no text content (stop_reason: ${response.stop_reason ?? "unknown"})`,
  );
  return null;
}

async function callOpenAI(
  prompt: string,
  model: string,
): Promise<string | null> {
  const { default: OpenAI } = await import("openai");
  const client = new OpenAI({ timeout: 15_000 });
  const response = await client.chat.completions.create({
    model,
    max_tokens: 256,
    messages: [{ role: "user", content: prompt }],
  });
  const content = response.choices[0]?.message?.content;
  if (!content) {
    const finishReason = response.choices[0]?.finish_reason ?? "unknown";
    console.error(
      `Warning: OpenAI returned empty content (finish_reason: ${finishReason})`,
    );
    return null;
  }
  return content;
}

/* ------------------------------------------------------------------ */
/*  Main entry point                                                  */
/* ------------------------------------------------------------------ */

/**
 * Classify a folder using an LLM, with caching.
 *
 * @param cache - Shared cache map. When provided, the caller owns saving
 *   after the full traversal (cheaper + consistent across recursion). When
 *   omitted, a fresh cache is loaded and saved per-call — used for one-shot
 *   tests and the root call before recursion sets up a shared map.
 */
export async function agentClassify(
  folderPath: string,
  signals: FolderSignals,
  heuristicRole: FolderRole,
  config: Config,
  rootDir: string,
  parentContext?: string,
  cache?: Map<string, CacheEntry>,
): Promise<AgentClassification> {
  const hash = computeSignalHash(signals);
  const cacheKey = path.relative(rootDir, folderPath) || ".";

  const effectiveCache = cache ?? loadAgentCache(rootDir);
  const cached = effectiveCache.get(cacheKey);
  if (cached && cached.signalHash === hash) {
    return {
      role: cached.role,
      name: cached.name,
      description: cached.description,
      confidence: cached.confidence,
    };
  }

  const prompt = buildPrompt(folderPath, rootDir, signals, heuristicRole, parentContext);
  const { provider, model } = config.agent;

  let responseText: string | null;
  try {
    switch (provider) {
      case "anthropic":
        responseText = await callAnthropic(prompt, model);
        break;
      case "openai":
        responseText = await callOpenAI(prompt, model);
        break;
      default: {
        const _exhaustive: never = provider;
        throw new Error(`Unsupported LLM provider: ${_exhaustive}`);
      }
    }
  } catch (err: unknown) {
    const errCode = (err as NodeJS.ErrnoException).code;
    if (errCode === "MODULE_NOT_FOUND" || errCode === "ERR_MODULE_NOT_FOUND") {
      throw new Error(
        `${provider} SDK not installed. Run: npm install ${provider === "anthropic" ? "@anthropic-ai/sdk" : "openai"}`,
      );
    }

    const status = (err as { status?: number }).status;
    if (status === 401 || status === 403) {
      throw new Error(
        `${provider} authentication failed (HTTP ${status}). Check your API key environment variable.`,
      );
    }
    if (status === 429) {
      console.error(
        `Warning: LLM API rate limited for ${cacheKey}. Consider adding a delay or reducing concurrency. Falling back to heuristic.`,
      );
    } else {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(
        `Warning: LLM classification failed for ${cacheKey}, falling back to heuristic: ${msg}`,
      );
    }
    return {
      role: heuristicRole,
      name: "",
      description: "",
      confidence: 0,
      failed: true,
    };
  }

  // Parse response — fall back to heuristic role on parse failure
  const parsed = responseText ? parseAgentResponse(responseText) : null;
  const classification: AgentClassification = parsed ?? {
    role: heuristicRole,
    name: "",
    description: "",
    confidence: 0,
    failed: true,
  };

  // Skip caching fallback results so the LLM is retried next run.
  // Invariant: confidence === 0 is only produced by our fallback paths
  // (parse failure or exception above), never returned by a real LLM call.
  if (classification.confidence > 0) {
    effectiveCache.set(cacheKey, { ...classification, signalHash: hash });
  }
  if (!cache) {
    saveAgentCache(rootDir, effectiveCache);
  }

  return classification;
}
