export const MANAGED_TAG = "ddocs_managed=1";

export type StyleKey =
  | "person"
  | "system"
  | "external-system"
  | "container"
  | "component"
  | "system-boundary"
  | "code-class"
  | "code-fn"
  | "relationship";

const BASE: Record<StyleKey, string> = {
  person:
    "shape=umlActor;verticalLabelPosition=bottom;verticalAlign=top;html=1;fillColor=#08427B;strokeColor=#073B6F;fontColor=#ffffff",
  system:
    "rounded=1;whiteSpace=wrap;html=1;fillColor=#1168BD;strokeColor=#0E5CA8;fontColor=#ffffff",
  "external-system":
    "rounded=1;whiteSpace=wrap;html=1;fillColor=#999999;strokeColor=#8A8A8A;fontColor=#ffffff",
  container:
    "rounded=1;whiteSpace=wrap;html=1;fillColor=#438DD5;strokeColor=#3C7FC0;fontColor=#ffffff",
  component:
    "rounded=1;whiteSpace=wrap;html=1;fillColor=#85BBF0;strokeColor=#78A8D8;fontColor=#000000",
  "system-boundary":
    "rounded=1;whiteSpace=wrap;html=1;fillColor=none;strokeColor=#444444;dashed=1;fontColor=#444444",
  "code-class":
    "rounded=0;whiteSpace=wrap;html=1;fillColor=#dae8fc;strokeColor=#6c8ebf;fontColor=#000000",
  "code-fn":
    "rounded=1;whiteSpace=wrap;html=1;fillColor=#d5e8d4;strokeColor=#82b366;fontColor=#000000",
  // Opaque white label background + no border keeps edge labels legible
  // when orthogonal routing causes them to overlap other edges. Explicit
  // black fontColor is required because drawio's dark-mode default flips
  // fontColor to white — without this, edge labels render white-on-white
  // and look like empty white rectangles.
  relationship:
    "endArrow=classic;html=1;rounded=0;strokeColor=#707070;fontSize=11;" +
    "edgeStyle=orthogonalEdgeStyle;curved=0;" +
    "fontColor=#000000;labelBackgroundColor=#ffffff;labelBorderColor=none",
};

export function withManagedTag(style: string): string {
  if (isManagedStyle(style)) return style;
  const trimmed = style.endsWith(";") ? style.slice(0, -1) : style;
  return `${trimmed};${MANAGED_TAG}`;
}

export function isManagedStyle(style: string): boolean {
  return style.split(";").some((p) => p.trim() === MANAGED_TAG);
}

export const STYLES: Record<StyleKey, string> = Object.fromEntries(
  Object.entries(BASE).map(([k, v]) => [k, withManagedTag(v)]),
) as Record<StyleKey, string>;
