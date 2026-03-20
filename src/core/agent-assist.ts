import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import * as YAML from "yaml";
import type { Config, FolderRole } from "../config/schema.js";
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
  } catch {
    // Corrupted cache — start fresh
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
}

/* ------------------------------------------------------------------ */
/*  Response parsing                                                  */
/* ------------------------------------------------------------------ */

const VALID_ROLES = new Set<FolderRole>([
  "system",
  "container",
  "component",
  "code-only",
  "skip",
]);

const FALLBACK: AgentClassification = {
  role: "skip",
  name: "",
  description: "",
  confidence: 0,
};

/**
 * Extract a JSON classification from the LLM response text.
 * Handles responses wrapped in markdown code blocks.
 */
export function parseAgentResponse(text: string): AgentClassification {
  try {
    // Strip optional markdown code fences
    let cleaned = text.trim();
    const fenceMatch = cleaned.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
    if (fenceMatch) {
      cleaned = fenceMatch[1].trim();
    }

    const parsed = JSON.parse(cleaned) as Record<string, unknown>;

    const role = parsed.role as FolderRole;
    if (!VALID_ROLES.has(role)) return { ...FALLBACK };

    const name = typeof parsed.name === "string" ? parsed.name : "";
    const description =
      typeof parsed.description === "string" ? parsed.description : "";
    const confidence =
      typeof parsed.confidence === "number"
        ? Math.max(0, Math.min(1, parsed.confidence))
        : 0;

    return { role, name, description, confidence };
  } catch {
    return { ...FALLBACK };
  }
}

/* ------------------------------------------------------------------ */
/*  Prompt building                                                   */
/* ------------------------------------------------------------------ */

function buildPrompt(
  folderPath: string,
  signals: FolderSignals,
  heuristicRole: FolderRole,
  parentContext?: string,
): string {
  const lines: string[] = [
    "Classify this folder in a software project for C4 architecture diagramming.",
    "",
    `Folder: ${folderPath}`,
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
  const client = new Anthropic();
  const response = await client.messages.create({
    model,
    max_tokens: 256,
    messages: [{ role: "user", content: prompt }],
  });
  const block = response.content[0];
  if (block.type === "text") return block.text;
  return "";
}

async function callOpenAI(
  prompt: string,
  model: string,
): Promise<string> {
  // Dynamic import — SDK may not be installed
  const { default: OpenAI } = await import("openai");
  const client = new OpenAI();
  const response = await client.chat.completions.create({
    model,
    max_tokens: 256,
    messages: [{ role: "user", content: prompt }],
  });
  return response.choices[0]?.message?.content ?? "";
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
 * 4. Parse response
 * 5. Cache and return
 */
export async function agentClassify(
  folderPath: string,
  signals: FolderSignals,
  heuristicRole: FolderRole,
  config: Config,
  rootDir: string,
  parentContext?: string,
): Promise<AgentClassification> {
  const hash = computeSignalHash(signals);

  // Check cache
  const cache = loadAgentCache(rootDir);
  const cached = cache.get(folderPath);
  if (cached && cached.signalHash === hash) {
    return {
      role: cached.role,
      name: cached.name,
      description: cached.description,
      confidence: cached.confidence,
    };
  }

  // Build prompt and call LLM
  const prompt = buildPrompt(folderPath, signals, heuristicRole, parentContext);
  const { provider, model } = config.agent;

  let responseText: string;
  try {
    if (provider === "anthropic") {
      responseText = await callAnthropic(prompt, model);
    } else {
      responseText = await callOpenAI(prompt, model);
    }
  } catch {
    // LLM unavailable — fall back to heuristic
    return {
      role: heuristicRole,
      name: "",
      description: "",
      confidence: 0,
    };
  }

  // Parse response
  const classification = parseAgentResponse(responseText);

  // Cache result
  cache.set(folderPath, { ...classification, signalHash: hash });
  saveAgentCache(rootDir, cache);

  return classification;
}
