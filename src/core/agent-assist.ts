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
}

interface CacheEntry extends AgentClassification {
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
        map.set(key, entry);
      }
    }
  } catch (err: unknown) {
    console.error(
      `Warning: agent cache at ${filePath} is corrupted, deleting and starting fresh: ${err instanceof Error ? err.message : err}`,
    );
    try { fs.unlinkSync(filePath); } catch { /* best-effort cleanup */ }
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
    fs.writeFileSync(filePath, YAML.stringify(obj), "utf-8");
  } catch (err: unknown) {
    console.error(
      `Warning: failed to save agent cache (LLM results will not be cached, incurring additional API costs): ${err instanceof Error ? err.message : err}`,
    );
  }
}

/* ------------------------------------------------------------------ */
/*  Response parsing                                                  */
/* ------------------------------------------------------------------ */

const VALID_ROLES = new Set<FolderRole>(roleEnum.options);

const FALLBACK: AgentClassification = {
  role: "skip",
  name: "",
  description: "",
  confidence: 0,
};

/**
 * Extract a JSON classification from the LLM response text.
 * Handles responses wrapped in markdown code blocks.
 * Returns null when the response cannot be parsed, so the caller can decide the fallback.
 */
export function parseAgentResponse(text: string): AgentClassification | null {
  try {
    // Strip optional markdown code fences
    let cleaned = text.trim();
    const fenceMatch = cleaned.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
    if (fenceMatch) {
      cleaned = fenceMatch[1].trim();
    }

    const parsed = JSON.parse(cleaned) as Record<string, unknown>;

    const role = parsed.role as FolderRole;
    if (!VALID_ROLES.has(role)) return null;

    const name = typeof parsed.name === "string" ? parsed.name : "";
    const description =
      typeof parsed.description === "string" ? parsed.description : "";
    const confidence =
      typeof parsed.confidence === "number"
        ? Math.max(0, Math.min(1, parsed.confidence))
        : 0;

    return { role, name, description, confidence };
  } catch {
    console.error(
      `Warning: could not parse LLM classification response: ${text.slice(0, 200)}${text.length > 200 ? "..." : ""}`,
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
/* ------------------------------------------------------------------ */

async function callAnthropic(
  prompt: string,
  model: string,
): Promise<string> {
  // Dynamic import — SDK may not be installed
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
  return "";
}

async function callOpenAI(
  prompt: string,
  model: string,
): Promise<string> {
  // Dynamic import — SDK may not be installed
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
    return "";
  }
  return content;
}

/* ------------------------------------------------------------------ */
/*  Main entry point                                                  */
/* ------------------------------------------------------------------ */

/**
 * Classify a folder using an LLM, with caching.
 *
 * 1. Compute signal hash
 * 2. Check cache — return cached result if hash matches
 * 3. Build prompt and call LLM
 * 4. Parse response (fall back to heuristic on parse failure)
 * 5. Cache and return
 *
 * @param cache - Shared cache map. Pass in a single map loaded once at the
 *   start of the run to avoid re-reading the YAML file on every call.
 *   The caller is responsible for saving the cache after the full traversal.
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

  // Check cache
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

  // Build prompt and call LLM
  const prompt = buildPrompt(folderPath, rootDir, signals, heuristicRole, parentContext);
  const { provider, model } = config.agent;

  let responseText: string;
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
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("MODULE_NOT_FOUND") || msg.includes("Cannot find module")) {
      throw new Error(
        `${provider} SDK not installed. Run: npm install ${provider === "anthropic" ? "@anthropic-ai/sdk" : "openai"}`,
      );
    }
    if (msg.includes("401") || msg.includes("auth") || msg.includes("API key")) {
      throw new Error(
        `${provider} authentication failed. Check your API key environment variable.`,
      );
    }
    console.error(
      `Warning: LLM classification failed for ${cacheKey}, falling back to heuristic: ${msg}`,
    );
    return {
      role: heuristicRole,
      name: "",
      description: "",
      confidence: 0,
    };
  }

  // Parse response — fall back to heuristic role on parse failure
  const classification = parseAgentResponse(responseText) ?? {
    role: heuristicRole,
    name: "",
    description: "",
    confidence: 0,
  };

  // Cache result
  effectiveCache.set(cacheKey, { ...classification, signalHash: hash });
  if (!cache) {
    saveAgentCache(rootDir, effectiveCache);
  }

  return classification;
}
