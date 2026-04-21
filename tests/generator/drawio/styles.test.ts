import { describe, it, expect } from "vitest";
import {
  STYLES,
  MANAGED_TAG,
  withManagedTag,
  isManagedStyle,
} from "../../../src/generator/drawio/styles.js";

describe("drawio styles", () => {
  it("exposes a style string per C4 kind", () => {
    expect(STYLES.person).toContain("shape=");
    expect(STYLES.system).toContain("fillColor=");
    expect(STYLES.container).toContain("fillColor=");
    expect(STYLES.component).toContain("fillColor=");
    expect(STYLES["external-system"]).toContain("fillColor=");
    expect(STYLES["code-class"]).toContain("fillColor=");
    expect(STYLES["code-fn"]).toContain("fillColor=");
    expect(STYLES.relationship).toContain("endArrow=");
  });

  it("MANAGED_TAG is the exact sentinel embedded in managed style strings", () => {
    expect(MANAGED_TAG).toBe("ddocs_managed=1");
  });

  it("withManagedTag appends the tag when missing", () => {
    expect(withManagedTag("rounded=1")).toBe("rounded=1;ddocs_managed=1");
  });

  it("withManagedTag is idempotent", () => {
    const s = withManagedTag(withManagedTag("rounded=1"));
    expect(s.match(/ddocs_managed=1/g)?.length).toBe(1);
  });

  it("isManagedStyle detects the tag regardless of position", () => {
    expect(isManagedStyle("rounded=1;ddocs_managed=1;strokeColor=black")).toBe(
      true,
    );
    expect(isManagedStyle("rounded=1;strokeColor=black")).toBe(false);
  });

  it("all STYLES are pre-tagged as managed", () => {
    for (const key of Object.keys(STYLES)) {
      expect(isManagedStyle(STYLES[key as keyof typeof STYLES])).toBe(true);
    }
  });

  it("relationship style uses orthogonal routing and theme-default label colors", () => {
    expect(STYLES.relationship).toContain("edgeStyle=orthogonalEdgeStyle");
    expect(STYLES.relationship).toContain("curved=0");
    // Theme-agnostic: no explicit fontColor or labelBackgroundColor so
    // drawio picks black/white from the active theme (light/dark mode).
    expect(STYLES.relationship).not.toContain("fontColor=");
    expect(STYLES.relationship).not.toContain("labelBackgroundColor=");
  });
});
