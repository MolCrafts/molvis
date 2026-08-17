import {
  type AnalysisDefinition,
  CLUSTER_ANALYSIS_ID,
  POWER_SPECTRUM_ANALYSIS_ID,
} from "@molcrafts/molvis-stage";
import { describe, expect, it } from "@rstest/core";
import { GenericAnalysisPanel } from "../../../../src/ui/layout/analysis/GenericAnalysisPanel";
import { mountComponent } from "../../../react_harness";
import { readEmptyState, tutorialCopyIn } from "../empty_state_probe";

/**
 * Empty = title only (`.claude/notes/compute-form-design.md`, spec ac-002).
 * A parameterless definition plus `app: null` is the panel's idle state: the
 * run state starts `idle`, nothing is blocked, and no compute is reachable.
 *
 * Routing (`.claude/specs/worker-catalog-dispatch-06-panels.md`) is asserted by
 * `analysisRunPlan.test.ts`, not here: this environment cannot inject a fake
 * compute host, so **no test below clicks Run** — a click would go looking for
 * the real worker. What these pin is the part routing must leave alone: the
 * pre-run copy and the disabled Run control, whichever route a definition takes.
 */

const TUTORIAL_COPY = ["Adjust scope and parameters, then run this analysis."];

const DEFINITION: AnalysisDefinition = {
  id: "rdf.radial_distribution",
  category: "structure",
  label: "RDF",
  wasmExport: "Rdf",
  inputKind: "frame",
  resultKind: "lineSeries",
  requires: [],
  params: [],
};

/**
 * A `"worker"`-routed analysis: a per-frame shape needing nothing beyond
 * positions, so `snapshotCoversAnalysis` says a snapshot expresses it and the
 * panel submits it to the analysis worker. Hand-written literal; the catalog
 * fields are goldens from the molrs compute catalog 0.13.1, read 2026-08-14.
 */
const WORKER_DEFINITION: AnalysisDefinition = {
  id: CLUSTER_ANALYSIS_ID,
  category: "cluster",
  label: "Cluster analysis",
  wasmExport: "Cluster",
  inputKind: "frame",
  resultKind: "barSeries",
  requires: [],
  params: [],
};

/**
 * A `"main"`-routed analysis: the `series` shape stacks velocity columns a
 * snapshot does not carry, so it stays on the main thread. It is also
 * series-shaped, which is what drives the panel's `No series yet` copy —
 * `isSeriesLike` reads `inputKind` / `resultKind`, never the route.
 */
const SERIES_DEFINITION: AnalysisDefinition = {
  id: POWER_SPECTRUM_ANALYSIS_ID,
  category: "spectroscopy",
  label: "Power spectrum",
  wasmExport: "WasmPowerSpectrum",
  inputKind: "series",
  resultKind: "lineSeries",
  requires: ["velocity"],
  params: [],
};

/** The footer Run control, labelled `Run <analysis>` while idle. */
function runControl(host: ParentNode, label: string): HTMLButtonElement {
  const button = host.querySelector<HTMLButtonElement>(
    `button[aria-label="Run ${label}"]`,
  );
  if (!button) throw new Error(`GenericAnalysisPanel rendered no Run ${label}`);
  return button;
}

describe("GenericAnalysisPanel", () => {
  it("shows a title-only empty state before the first run", async () => {
    const { host, cleanup } = await mountComponent(
      <GenericAnalysisPanel
        app={null}
        definition={DEFINITION}
        frameRange={{}}
        selection={{ kind: "all" }}
      />,
    );
    try {
      const empty = readEmptyState(host);
      expect({
        title: empty?.title ?? null,
        descriptions: empty?.descriptions ?? null,
        tutorialCopy: tutorialCopyIn(host, TUTORIAL_COPY),
      }).toEqual({
        title: "No result yet",
        descriptions: [],
        tutorialCopy: [],
      });
    } finally {
      await cleanup();
    }
  });

  it("keeps Run disabled and the plain empty state for a worker-routed analysis without an app", async () => {
    const { host, cleanup } = await mountComponent(
      <GenericAnalysisPanel
        app={null}
        definition={WORKER_DEFINITION}
        frameRange={{}}
        selection={{ kind: "all" }}
      />,
    );
    try {
      const empty = readEmptyState(host);
      expect({
        title: empty?.title ?? null,
        descriptions: empty?.descriptions ?? null,
        runDisabled: runControl(host, WORKER_DEFINITION.label).disabled,
      }).toEqual({
        title: "No result yet",
        descriptions: [],
        // No app means no trajectory to snapshot: the run bar refuses before
        // the router is ever consulted, so nothing here can reach a worker.
        runDisabled: true,
      });
    } finally {
      await cleanup();
    }
  });

  it("shows the series empty state for a main-routed series analysis", async () => {
    const { host, cleanup } = await mountComponent(
      <GenericAnalysisPanel
        app={null}
        definition={SERIES_DEFINITION}
        frameRange={{}}
        selection={{ kind: "all" }}
      />,
    );
    try {
      const empty = readEmptyState(host);
      expect({
        title: empty?.title ?? null,
        descriptions: empty?.descriptions ?? null,
        runDisabled: runControl(host, SERIES_DEFINITION.label).disabled,
      }).toEqual({
        title: "No series yet",
        descriptions: [],
        runDisabled: true,
      });
    } finally {
      await cleanup();
    }
  });
});
