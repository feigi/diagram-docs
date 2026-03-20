import type { LanguageAnalyzer } from "./types.js";
import { javaAnalyzer } from "./java/index.js";
import { pythonAnalyzer } from "./python/index.js";
import { cAnalyzer } from "./c/index.js";

const analyzers: LanguageAnalyzer[] = [javaAnalyzer, pythonAnalyzer, cAnalyzer];

export function getRegistry(): LanguageAnalyzer[] {
  return analyzers;
}

export function getAnalyzer(id: string): LanguageAnalyzer | undefined {
  return analyzers.find((a) => a.id === id);
}
