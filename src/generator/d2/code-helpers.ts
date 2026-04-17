import type {
  ArchitectureModel,
  CodeElement,
  Component,
  RawStructure,
} from "../../analyzers/types.js";
import {
  selectProfileForComponent,
  type ProfileLanguage,
} from "./code-profiles.js";

/**
 * Component IDs that qualify for a C4 code-level diagram
 * (i.e. code elements ≥ config.code.minElements).
 */
export function codeLinkableComponentIds(
  model: ArchitectureModel,
  minElements: number,
): Set<string> {
  const counts = new Map<string, number>();
  for (const e of model.codeElements ?? []) {
    counts.set(e.componentId, (counts.get(e.componentId) ?? 0) + 1);
  }
  const ids = new Set<string>();
  for (const [id, n] of counts) {
    if (n >= minElements) ids.add(id);
  }
  return ids;
}

export function dominantLanguageForComponent(
  component: Component,
  model: ArchitectureModel,
  rawStructure?: RawStructure,
): ProfileLanguage {
  const counts: Record<ProfileLanguage, number> = {
    java: 0,
    typescript: 0,
    python: 0,
    c: 0,
  };
  if (rawStructure) {
    for (const app of rawStructure.applications) {
      for (const mod of app.modules) {
        if (!component.moduleIds.includes(mod.id)) continue;
        const lang = normalizeLanguage(app.language);
        if (lang) counts[lang] += mod.files.length;
      }
    }
  }
  const totalFromRaw =
    counts.java + counts.typescript + counts.python + counts.c;
  if (totalFromRaw === 0) {
    // Fall back to inferring from already-resolved CodeElements when raw
    // structure is unavailable (e.g. user passed --model directly). Without
    // this, every component would silently render with the Java profile —
    // wrong shapes for C-only components.
    for (const el of model.codeElements ?? []) {
      if (el.componentId !== component.id) continue;
      const lang = languageFromKind(el.kind);
      if (lang) counts[lang] += 1;
    }
  }
  const picked = selectProfileForComponent(counts);
  if (!picked) {
    console.error(
      `Warning: cannot infer language for component "${component.id}"; defaulting to java profile. ` +
        `Pass --model with a rawStructure or ensure components contain at least one kind-distinct element.`,
    );
    return "java";
  }
  return picked;
}

function languageFromKind(kind: CodeElement["kind"]): ProfileLanguage | null {
  switch (kind) {
    case "struct":
    case "typedef":
      return "c";
    case "type":
      return "typescript";
    case "enum":
      return "java";
    case "class":
    case "interface":
    case "function":
      return null; // ambiguous across languages
  }
}

function normalizeLanguage(raw: string): ProfileLanguage | null {
  if (raw === "java") return "java";
  if (raw === "typescript") return "typescript";
  if (raw === "python") return "python";
  if (raw === "c") return "c";
  return null;
}
