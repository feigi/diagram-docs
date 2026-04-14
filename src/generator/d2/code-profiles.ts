import { toD2Id } from "./stability.js";
import type { LanguageRenderingProfile } from "./code.js";

export type ProfileLanguage = "java" | "typescript" | "python" | "c";

export function getProfileForLanguage(
  lang: ProfileLanguage,
): LanguageRenderingProfile {
  return lang === "c" ? cProfile : javaTsPyProfile;
}

const javaTsPyProfile: LanguageRenderingProfile = {
  renderHeader(w, component) {
    w.comment(`Component: ${component.name}`);
    w.blank();
  },
  renderElements(w, elements) {
    for (const el of elements) {
      w.shape(toD2Id(el.id), el.name, { shape: "class" });
      // Members will be added in Task 14.
    }
  },
  renderExternalRefs(w, externalRels) {
    const seen = new Set<string>();
    for (const r of externalRels) {
      if (seen.has(r.targetId)) continue;
      seen.add(r.targetId);
      w.shape(toD2Id(r.targetId), r.targetId.split(".").pop() ?? r.targetId, {
        style: "dashed",
      });
    }
  },
  renderRelationships(w, rels) {
    for (const r of rels) {
      w.connection(toD2Id(r.sourceId), toD2Id(r.targetId), r.kind);
    }
  },
};

const cProfile: LanguageRenderingProfile = javaTsPyProfile; // replaced in Task 15
