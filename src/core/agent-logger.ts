/**
 * Per-agent log file writer for parallel LLM builds.
 * Appends timestamped sections (prompts, thinking, output, done/failed)
 * to a plain text log file for post-mortem debugging.
 */
import * as fs from "node:fs";
import type { ProgressEvent } from "./llm-model-builder.js";

function timestamp(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

function elapsedSeconds(ms: number): string {
  return `${Math.round(ms / 1000)}s`;
}

export class AgentLogger {
  private readonly logPath: string;
  private readonly metadata: { appId: string; model: string; provider: string };
  private buffer: string = "";
  private currentKind: ProgressEvent["kind"] | null = null;

  constructor(
    logPath: string,
    metadata: { appId: string; model: string; provider: string },
  ) {
    this.logPath = logPath;
    this.metadata = metadata;
  }

  logPrompt(systemPrompt: string, userMessage: string): void {
    const { appId, model, provider } = this.metadata;
    this.buffer += `[${timestamp()}] START app=${appId} model=${model} provider=${provider}\n`;
    this.buffer += `[${timestamp()}] SYSTEM PROMPT\n`;
    this.buffer += systemPrompt + "\n";
    this.buffer += `[${timestamp()}] USER MESSAGE\n`;
    this.buffer += userMessage + "\n";
  }

  logProgress(event: ProgressEvent): void {
    if (event.kind !== this.currentKind) {
      this.flush();
      this.buffer += `[${timestamp()}] ${event.kind.toUpperCase()}\n`;
      this.currentKind = event.kind;
    }
    if (event.final) {
      this.buffer += event.line + "\n";
    }
  }

  async logDone(elapsedMs: number): Promise<void> {
    this.buffer += `[${timestamp()}] DONE elapsed=${elapsedSeconds(elapsedMs)}\n`;
    await this.flush();
  }

  async logFailed(error: string, elapsedMs: number): Promise<void> {
    this.buffer += `[${timestamp()}] FAILED elapsed=${elapsedSeconds(elapsedMs)} error=${error}\n`;
    await this.flush();
  }

  private flush(): Promise<void> {
    if (!this.buffer) return Promise.resolve();
    const data = this.buffer;
    this.buffer = "";
    return fs.promises.writeFile(this.logPath, data, { flag: "a" }).catch((err) => {
      try {
        process.stderr.write(`Warning: failed to write agent log ${this.logPath}: ${err.message}\n`);
      } catch { /* stderr unavailable */ }
    });
  }
}
