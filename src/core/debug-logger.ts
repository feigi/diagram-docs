/**
 * Per-LLM-call debug log writer.
 * When --debug is enabled, writes a structured log file for each LLM call
 * containing the system prompt, user message, thinking (indented), and output.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import type { ProgressEvent } from "./llm-model-builder.js";

const THINKING_INDENT = "    "; // 4 spaces

const DEBUG_DIR = path.join(".diagram-docs", "debug");

export interface DebugLogMetadata {
  provider: string;
  model: string;
}

export class DebugLogWriter {
  private readonly filePath: string;
  private readonly metadata: DebugLogMetadata;
  private systemPrompt = "";
  private userMessage = "";
  private thinkingLines: string[] = [];
  private outputLines: string[] = [];

  constructor(opts: {
    dir: string;
    label: string;
    metadata: DebugLogMetadata;
  }) {
    this.filePath = path.join(opts.dir, `${opts.label}.log`);
    this.metadata = opts.metadata;
  }

  logPrompt(systemPrompt: string, userMessage: string): void {
    this.systemPrompt = systemPrompt;
    this.userMessage = userMessage;
  }

  logProgress(event: ProgressEvent): void {
    if (!event.final) return;
    if (event.kind === "thinking") {
      this.thinkingLines.push(event.line);
    } else {
      this.outputLines.push(event.line);
    }
  }

  finish(elapsedMs: number): void {
    this.writeFile(elapsedMs);
  }

  finishWithError(error: string, elapsedMs: number): void {
    this.writeFile(elapsedMs, error);
  }

  private writeFile(elapsedMs: number, error?: string): void {
    const parts: string[] = [];

    // Header
    parts.push(
      `=== LLM CALL DEBUG LOG ===`,
      `Provider: ${this.metadata.provider}`,
      `Model:    ${this.metadata.model}`,
      `Elapsed:  ${Math.round(elapsedMs / 1000)}s`,
    );
    if (error) {
      parts.push(`Error:    ${error}`);
    }
    parts.push("");

    // System prompt
    parts.push(`=== SYSTEM PROMPT ===`, this.systemPrompt, "");

    // User message
    parts.push(`=== USER MESSAGE ===`, this.userMessage, "");

    // Thinking (indented)
    if (this.thinkingLines.length > 0) {
      parts.push(
        `=== THINKING ===`,
        ...this.thinkingLines.map((l) => THINKING_INDENT + l),
        "",
      );
    }

    // Output
    if (this.outputLines.length > 0) {
      parts.push(`=== OUTPUT ===`, ...this.outputLines, "");
    }

    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      fs.writeFileSync(this.filePath, parts.join("\n"));
    } catch {
      // Debug logging must never crash the tool
      try {
        process.stderr.write(
          `Warning: failed to write debug log ${this.filePath}\n`,
        );
      } catch {
        /* stderr unavailable */
      }
    }
  }
}

/**
 * Prepare the debug directory for a new run.
 * Clears any existing debug logs and creates the directory fresh.
 * Returns the absolute path to the debug directory.
 */
export function prepareDebugDir(): string {
  fs.rmSync(DEBUG_DIR, { recursive: true, force: true });
  fs.mkdirSync(DEBUG_DIR, { recursive: true });
  return DEBUG_DIR;
}

export { DEBUG_DIR };
