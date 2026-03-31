/**
 * Signal detection engine for identifying architecture-relevant patterns
 * in config file content. Provides a pattern registry and noise denylist
 * for deterministic extraction of infrastructure signals.
 */

export type SignalType =
  | "database-url"
  | "message-broker"
  | "cache-endpoint"
  | "search-endpoint"
  | "object-storage"
  | "service-endpoint"
  | "server-config"
  | "env-infrastructure";

export interface ConfigSignal {
  readonly type: SignalType;
  readonly value: string;
  readonly line: number;
  readonly matchedPattern: string;
  readonly filePath: string;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function detectConfigSignals(
  configFiles: ReadonlyArray<{
    readonly path: string;
    readonly content: string;
  }>,
): ConfigSignal[] {
  return [];
}
