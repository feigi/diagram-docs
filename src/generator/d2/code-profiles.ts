import { toD2Id } from "./stability.js";
import type { LanguageRenderingProfile } from "./code.js";

export type ProfileLanguage = "java" | "typescript" | "python" | "c";

export function getProfileForLanguage(
  lang: ProfileLanguage,
): LanguageRenderingProfile {
  return lang === "c" ? cProfile : javaTsPyProfile;
}

/**
 * Pick the language profile with the highest file count. Returns null when
 * every count is zero — caller must decide how to handle the ambiguous case
 * (warn + default, skip, etc.) rather than silently picking a language.
 */
export function selectProfileForComponent(
  fileCountsByLanguage: Record<ProfileLanguage, number>,
): ProfileLanguage | null {
  const order: ProfileLanguage[] = ["java", "typescript", "python", "c"];
  let winner: ProfileLanguage | null = null;
  let winnerCount = 0;
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
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r?\n/g, " ");
}

// D2 rejects keys longer than 518 chars. Spring @RestController signatures
// with inline annotations routinely blow past that. Truncate with an ellipsis
// so long members still render without breaking diagram compilation.
const D2_KEY_LIMIT = 518;
function memberLine(m: { name: string; signature?: string }): string {
  const escaped = escapeLabel(m.signature ?? m.name);
  if (escaped.length <= D2_KEY_LIMIT) return `"${escaped}"`;
  let head = escaped.slice(0, D2_KEY_LIMIT - 3);
  // Avoid ending on a lone backslash that would escape the closing quote.
  const trailingBackslashes = head.match(/\\+$/)?.[0].length ?? 0;
  if (trailingBackslashes % 2 === 1) head = head.slice(0, -1);
  return `"${head}..."`;
}

const javaTsPyProfile: LanguageRenderingProfile = {
  renderHeader(w, component) {
    w.comment(`Component: ${component.name}`);
    w.blank();
  },
  renderElements(w, elements) {
    for (const el of elements) {
      // `type` is a symbol kind now — it carries `signature`, never `members`.
      // So only container kinds (class/interface/enum) can render the member
      // block; everything else falls through to the plain-shape branch.
      const isContainer =
        el.kind === "class" || el.kind === "interface" || el.kind === "enum";
      if (isContainer && (el.members?.length ?? 0) > 0) {
        w.container(toD2Id(el.id), el.name, () => {
          w.raw("shape: class");
          for (const m of el.members ?? []) {
            w.raw(memberLine(m));
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
      const label = r.targetName ?? r.targetId.split(".").pop() ?? r.targetId;
      w.shape(toD2Id(r.targetId), label, { "style.stroke-dash": "3" });
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
          // `struct` carries members; `typedef` does not (symbol kind).
          // Narrow here so TS knows `.members` is valid only on the struct
          // branch — typedef renders as a bare class shape with its name.
          w.container(toD2Id(el.id), el.name, () => {
            w.raw("shape: class");
            if (el.kind === "struct") {
              for (const m of el.members ?? []) {
                w.raw(memberLine(m));
              }
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
      const label = r.targetName ?? r.targetId.split(".").pop() ?? r.targetId;
      w.shape(toD2Id(r.targetId), label, { "style.stroke-dash": "3" });
    }
  },
  renderRelationships(w, rels) {
    for (const r of rels) {
      if (r.kind === "inherits" || r.kind === "implements") continue; // C has neither
      w.connection(toD2Id(r.sourceId), toD2Id(r.targetId), r.kind);
    }
  },
};
