import {
  type AnalysisDefinition,
  type AnalysisInputKind,
  type AnalysisRequirement,
  COM_ANALYSIS_ID,
  MSD_ANALYSIS_ID,
  RDF_ANALYSIS_ID,
  RG_ANALYSIS_ID,
  snapshotCoversAnalysis,
} from "@molcrafts/molvis-stage";
import { describe, expect, it } from "@rstest/core";
import { planAnalysisRun } from "../../../../src/ui/layout/analysis/analysisRunPlan";

/**
 * The analysis panel's run router
 * (`.claude/specs/worker-catalog-dispatch-06-panels.md`).
 *
 * `planAnalysisRun` is a module of its own precisely so this file can exist:
 * page component tests mount real React in a headless browser and **cannot**
 * inject a fake compute host (`setComputeRuntimeForTests` is stage-internal,
 * and widening a public surface for a test is the wrong direction), so the
 * panel tests can only assert states that never reach a worker. The verdict
 * "which of the three paths does this analysis take" is a pure decision, and it
 * is exhausted here — no React, no worker, no WASM.
 *
 * Every definition below is a hand-written literal: the router reads `id`,
 * `inputKind` and `requires` and nothing else, so a catalog lookup would only
 * tie these cases to whatever catalog the current build happens to ship. The
 * ids come from the stage id constants, and the `inputKind` values used for
 * real catalog entries are hard-coded goldens read from the molrs compute
 * catalog 0.13.1 on 2026-08-14.
 */

/** A catalog entry carrying only the fields the router reads. */
function definition(
  id: string,
  inputKind: AnalysisInputKind,
  requires: AnalysisRequirement[],
): AnalysisDefinition {
  return {
    id,
    category: "test",
    label: "Routing fixture",
    wasmExport: "TestBinding",
    inputKind,
    resultKind: "lineSeries",
    requires,
    params: [],
  };
}

describe("TestPlanAnalysisRun", () => {
  it("routes center of mass to the pipeline even though a snapshot covers it", () => {
    // Order-sensitive on purpose: the fixture is snapshot-expressible, so this
    // only passes when the pipeline verdict is asked *before* coverage. COM has
    // to install its modifier and read the table back off the frame the canvas
    // just drew; a worker run would cluster a second time from its own truth,
    // which is the Canvas WYSIWYG = SceneIndex invariant broken.
    const com = definition(COM_ANALYSIS_ID, "frameClusters", []);
    expect({
      coverable: snapshotCoversAnalysis(com),
      route: planAnalysisRun(com).route,
    }).toEqual({ coverable: true, route: "pipeline" });
  });

  it("routes cluster properties to the pipeline even though a snapshot covers it", () => {
    // Same precedence, second pipeline id: radius of gyration is read back off
    // the same drawn frame as the `Radius of gyration` modifier wrote.
    const rg = definition(RG_ANALYSIS_ID, "frameClusters", []);
    expect({
      coverable: snapshotCoversAnalysis(rg),
      route: planAnalysisRun(rg).route,
    }).toEqual({ coverable: true, route: "pipeline" });
  });

  it("routes a per-frame analysis with no requirements to the worker", () => {
    // x / y / z + element + id + cell is exactly what a snapshot packs, so a
    // per-frame analysis needing nothing else is the plainest worker case.
    expect(
      planAnalysisRun(definition("test.per_frame", "frame", [])).route,
    ).toBe("worker");
  });

  it("routes an accumulating analysis with no requirements to the worker", () => {
    // `accumulate` is fed one snapshot at a time, so it crosses the wire just
    // as well as a per-frame shape.
    expect(
      planAnalysisRun(definition("test.accumulating", "accumulate", [])).route,
    ).toBe("worker");
  });

  it("keeps the `series` shape on the main thread", () => {
    // A `series` analysis consumes a velocity matrix stacked across frames and
    // the snapshot carries no velocity columns to stack.
    expect(planAnalysisRun(definition("test.series", "series", [])).route).toBe(
      "main",
    );
  });

  it("keeps an analysis that needs velocity columns on the main thread", () => {
    // `velocity` is a frame column (vx / vy / vz) the snapshot does not copy;
    // a per-frame shape does not rescue it.
    expect(
      planAnalysisRun(definition("test.needs_velocity", "frame", ["velocity"]))
        .route,
    ).toBe("main");
  });

  it("keeps the `frameGroupSets` shape on the main thread", () => {
    // Joint distributions need a per-observable atom-group editor — UI state,
    // not frame data — so no snapshot can carry it.
    expect(
      planAnalysisRun(definition("test.group_sets", "frameGroupSets", []))
        .route,
    ).toBe("main");
  });

  it("routes the RDF catalog entry to the worker with no id exception", () => {
    // RDF has its own panel, but the Generic panel's router must not know that:
    // an id special case here is exactly the drift this case forbids. Golden
    // `inputKind`: `frameNeighbors`, `requires: []` (molrs catalog 0.13.1).
    expect(
      planAnalysisRun(definition(RDF_ANALYSIS_ID, "frameNeighbors", [])).route,
    ).toBe("worker");
  });

  it("routes the MSD catalog entry to the worker with no id exception", () => {
    // Same for MSD. Golden `inputKind`: `accumulate`, `requires: []` (molrs
    // catalog 0.13.1).
    expect(
      planAnalysisRun(definition(MSD_ANALYSIS_ID, "accumulate", [])).route,
    ).toBe("worker");
  });
});
