import type { AnalysisDefinition } from "@molcrafts/molvis-stage";
import { describe, expect, it } from "@rstest/core";
import { GenericAnalysisPanel } from "../../../../src/ui/layout/analysis/GenericAnalysisPanel";
import { mountComponent } from "../../../react_harness";
import { readEmptyState, tutorialCopyIn } from "../empty_state_probe";

/**
 * Empty = title only (`.claude/notes/compute-form-design.md`, spec ac-002).
 * A parameterless definition plus `app: null` is the panel's idle state: the
 * run state starts `idle`, nothing is blocked, and no compute is reachable.
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
});
