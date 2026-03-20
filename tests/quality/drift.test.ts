import { describe, it, expect, afterAll } from "vitest";
import * as path from "node:path";
import type { ArchitectureModel } from "../../src/analyzers/types.js";
import { loadModel } from "../../src/core/model.js";
import { generateContextDiagram } from "../../src/generator/d2/context.js";
import { generateContainerDiagram } from "../../src/generator/d2/container.js";
import { generateComponentDiagram } from "../../src/generator/d2/component.js";
import type { DriftReport } from "./helpers/types.js";
import {
  extractD2ShapeIds,
  computeLineChurn,
} from "./helpers/metrics.js";
import {
  formatDriftReport,
  generateDriftSuggestions,
} from "./helpers/reporter.js";

const MODEL_PATH = path.resolve(__dirname, "../fixtures/model.yaml");

const reports: DriftReport[] = [];

afterAll(() => {
  console.log("\n" + "=".repeat(70));
  console.log("DRIFT SUMMARY");
  console.log("=".repeat(70));

  for (const report of reports) {
    console.log(formatDriftReport(report));
  }

  const allSuggestions = reports.flatMap((r) => r.suggestions);
  if (allSuggestions.length === 0) {
    console.log("\nNo drift issues detected.");
  } else {
    console.log(`\n${allSuggestions.length} suggestion(s) total.`);
  }
  console.log("");
});

/**
 * Deep-clone and mutate a model for drift testing.
 */
function cloneModel(model: ArchitectureModel): ArchitectureModel {
  return JSON.parse(JSON.stringify(model));
}

/**
 * Measure drift between two D2 outputs across all levels.
 */
function measureDrift(
  scenario: string,
  before: ArchitectureModel,
  after: ArchitectureModel,
  levels: ("context" | "container" | "component")[],
): DriftReport {
  let totalBefore = "";
  let totalAfter = "";
  const allIdsBefore: string[] = [];
  const allIdsAfter: string[] = [];

  for (const level of levels) {
    let d2Before: string;
    let d2After: string;

    if (level === "context") {
      d2Before = generateContextDiagram(before);
      d2After = generateContextDiagram(after);
    } else if (level === "container") {
      d2Before = generateContainerDiagram(before);
      d2After = generateContainerDiagram(after);
    } else {
      // Combine all container component diagrams
      d2Before = before.containers
        .map((c) => generateComponentDiagram(before, c.id))
        .join("\n");
      // Only generate for containers that exist in 'after'
      d2After = after.containers
        .map((c) => {
          try {
            return generateComponentDiagram(after, c.id);
          } catch {
            return "";
          }
        })
        .join("\n");
    }

    totalBefore += d2Before + "\n";
    totalAfter += d2After + "\n";

    allIdsBefore.push(...extractD2ShapeIds(d2Before));
    allIdsAfter.push(...extractD2ShapeIds(d2After));
  }

  const beforeIdSet = new Set(allIdsBefore);
  const afterIdSet = new Set(allIdsAfter);

  // Detect renames: IDs present in before but not after, paired with
  // IDs present in after but not before
  const removedIds = allIdsBefore.filter((id) => !afterIdSet.has(id));
  const addedIds = allIdsAfter.filter((id) => !beforeIdSet.has(id));

  // Heuristic: pair removed/added IDs as renames if they share a suffix
  const renames: Array<{ old: string; new: string }> = [];
  const pairedAdded = new Set<string>();

  for (const removed of removedIds) {
    const suffix = removed.split("_").slice(-1)[0];
    const candidate = addedIds.find(
      (a) => !pairedAdded.has(a) && a.endsWith(suffix),
    );
    if (candidate) {
      renames.push({ old: removed, new: candidate });
      pairedAdded.add(candidate);
    }
  }

  const churn = computeLineChurn(totalBefore, totalAfter);

  // Stability: fraction of IDs that remained unchanged
  const stableIds = allIdsBefore.filter((id) => afterIdSet.has(id));
  const stabilityScore =
    allIdsBefore.length === 0
      ? 1
      : stableIds.length / allIdsBefore.length;

  // Would user files break? If any removed IDs were referenced
  const userFilesBroken = removedIds.length > 0;

  const report: DriftReport = {
    scenario,
    stabilityScore,
    lineChurn: churn.churn,
    idChanges: removedIds.length + addedIds.length - renames.length,
    renames,
    userFilesBroken: userFilesBroken && renames.length > 0,
    suggestions: [],
  };
  report.suggestions = generateDriftSuggestions(report);

  return report;
}

describe("Drift: Determinism", () => {
  const model = loadModel(MODEL_PATH);

  it("same model produces identical context diagram", () => {
    const a = generateContextDiagram(model);
    const b = generateContextDiagram(model);
    expect(a).toBe(b);
  });

  it("same model produces identical container diagram", () => {
    const a = generateContainerDiagram(model);
    const b = generateContainerDiagram(model);
    expect(a).toBe(b);
  });

  it("same model produces identical component diagrams", () => {
    for (const container of model.containers) {
      const a = generateComponentDiagram(model, container.id);
      const b = generateComponentDiagram(model, container.id);
      expect(a).toBe(b);
    }
  });
});

describe("Drift: Additive changes", () => {
  const model = loadModel(MODEL_PATH);

  it("adding a container only adds lines, does not change existing", () => {
    const after = cloneModel(model);
    after.containers.push({
      id: "notification-service",
      applicationId: "services-notification",
      name: "Notification Service",
      description: "Sends notifications",
      technology: "Go",
    });

    const report = measureDrift(
      "Add a new container",
      model,
      after,
      ["context", "container"],
    );
    reports.push(report);

    // Existing content should be mostly stable
    expect(report.stabilityScore).toBeGreaterThanOrEqual(0.8);
    expect(report.renames).toHaveLength(0);
  });

  it("adding a component only affects its container's diagram", () => {
    const after = cloneModel(model);
    after.components.push({
      id: "user-validator",
      containerId: "user-api",
      name: "User Validator",
      description: "Validates user input",
      technology: "Java",
      moduleIds: [],
    });

    const report = measureDrift(
      "Add a new component",
      model,
      after,
      ["component"],
    );
    reports.push(report);

    expect(report.stabilityScore).toBeGreaterThanOrEqual(0.8);
    expect(report.renames).toHaveLength(0);
  });

  it("adding a relationship only adds a connection line", () => {
    const after = cloneModel(model);
    after.relationships.push({
      sourceId: "order-service",
      targetId: "email-provider",
      label: "Sends order confirmations",
      technology: "SMTP",
    });

    const report = measureDrift(
      "Add a new relationship",
      model,
      after,
      ["context", "container"],
    );
    reports.push(report);

    expect(report.stabilityScore).toBeGreaterThanOrEqual(0.9);
  });
});

describe("Drift: Rename scenarios", () => {
  const model = loadModel(MODEL_PATH);

  it("renaming a container ID causes ID drift", () => {
    const after = cloneModel(model);
    const container = after.containers.find((c) => c.id === "user-api")!;
    container.id = "account-api";
    container.name = "Account API";

    // Update component refs
    for (const comp of after.components) {
      if (comp.containerId === "user-api") comp.containerId = "account-api";
    }
    // Update relationship refs
    for (const rel of after.relationships) {
      if (rel.sourceId === "user-api") rel.sourceId = "account-api";
      if (rel.targetId === "user-api") rel.targetId = "account-api";
    }

    const report = measureDrift(
      "Rename container: user-api -> account-api",
      model,
      after,
      ["context", "container", "component"],
    );
    reports.push(report);

    // This SHOULD cause drift — we're measuring how much
    expect(report.renames.length).toBeGreaterThan(0);
  });

  it("renaming a component ID causes localized drift", () => {
    const after = cloneModel(model);
    const comp = after.components.find((c) => c.id === "user-controller")!;
    comp.id = "user-rest-controller";

    // Update relationship refs
    for (const rel of after.relationships) {
      if (rel.sourceId === "user-controller")
        rel.sourceId = "user-rest-controller";
      if (rel.targetId === "user-controller")
        rel.targetId = "user-rest-controller";
    }

    const report = measureDrift(
      "Rename component: user-controller -> user-rest-controller",
      model,
      after,
      ["component"],
    );
    reports.push(report);

    // Drift should be contained to the component level
    expect(report.renames.length).toBeGreaterThanOrEqual(1);
  });
});

describe("Drift: Removal scenarios", () => {
  const model = loadModel(MODEL_PATH);

  it("removing a container measures impact", () => {
    const after = cloneModel(model);
    after.containers = after.containers.filter((c) => c.id !== "order-service");
    after.components = after.components.filter(
      (c) => c.containerId !== "order-service",
    );
    after.relationships = after.relationships.filter(
      (r) => r.sourceId !== "order-service" && r.targetId !== "order-service",
    );

    const report = measureDrift(
      "Remove container: order-service",
      model,
      after,
      ["context", "container"],
    );
    reports.push(report);

    // Remaining elements should be stable
    expect(report.stabilityScore).toBeGreaterThanOrEqual(0.5);
  });

  it("removing an actor measures impact", () => {
    const after = cloneModel(model);
    after.actors = [];
    after.relationships = after.relationships.filter(
      (r) => r.sourceId !== "user" && r.targetId !== "user",
    );

    const report = measureDrift(
      "Remove all actors",
      model,
      after,
      ["context", "container"],
    );
    reports.push(report);
  });
});
