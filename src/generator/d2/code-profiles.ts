import { toD2Id } from "./stability.js";
import type { LanguageRenderingProfile } from "./code.js";

export type ProfileLanguage = "java" | "typescript" | "python" | "c";

export function getProfileForLanguage(
  lang: ProfileLanguage,
): LanguageRenderingProfile {
  return lang === "c" ? cProfile : javaTsPyProfile;
}

export function selectProfileForComponent(
  fileCountsByLanguage: Record<ProfileLanguage, number>,
): ProfileLanguage {
  const order: ProfileLanguage[] = ["java", "typescript", "python", "c"];
  let winner: ProfileLanguage = "java";
  let winnerCount = -1;
  for (const lang of order) {
    const count = fileCountsByLanguage[lang] ?? 0;
    if (count > winnerCount) {
      winner = lang;
      winnerCount = count;
    }
  }
  return winner;
}

function escapeLabel(s: string): string {
  return s.replace(/"/g, '\\"');
}

const javaTsPyProfile: LanguageRenderingProfile = {
  renderHeader(w, component) {
    w.comment(`Component: ${component.name}`);
    w.blank();
  },
  renderElements(w, elements) {
    for (const el of elements) {
      if (
        (el.kind === "class" ||
          el.kind === "interface" ||
          el.kind === "enum" ||
          el.kind === "type") &&
        (el.members?.length ?? 0) > 0
      ) {
        w.container(toD2Id(el.id), el.name, () => {
          w.raw("shape: class");
          for (const m of el.members ?? []) {
            w.raw(`"${escapeLabel(m.signature ?? m.name)}"`);
          }
        });
      } else {
        const shape = el.kind === "function" ? undefined : "class";
        w.shape(toD2Id(el.id), el.name, shape ? { shape } : undefined);
      }
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

const cProfile: LanguageRenderingProfile = {
  renderHeader(w, component) {
    w.comment(`Component: ${component.name}`);
    w.blank();
  },
  renderElements(w, elements) {
    const types = elements.filter(
      (e) => e.kind === "struct" || e.kind === "typedef",
    );
    const publicFns = elements.filter(
      (e) => e.kind === "function" && e.visibility !== "private",
    );
    const internalFns = elements.filter(
      (e) => e.kind === "function" && e.visibility === "private",
    );

    if (types.length > 0) {
      w.container("types", "Types", () => {
        for (const el of types) {
          w.container(toD2Id(el.id), el.name, () => {
            w.raw("shape: class");
            for (const m of el.members ?? []) {
              w.raw(`"${escapeLabel(m.signature ?? m.name)}"`);
            }
          });
        }
      });
    }
    if (publicFns.length > 0) {
      w.container("public", "Public API", () => {
        for (const el of publicFns) w.shape(toD2Id(el.id), el.name);
      });
    }
    if (internalFns.length > 0) {
      w.container("internal", "Internal", () => {
        for (const el of internalFns) w.shape(toD2Id(el.id), el.name);
      });
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
      if (r.kind === "inherits" || r.kind === "implements") continue; // C has neither
      w.connection(toD2Id(r.sourceId), toD2Id(r.targetId), r.kind);
    }
  },
};
