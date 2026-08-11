import { describe, expect, it } from "@rstest/core";
import { AnalysisRunBar } from "../../../../src/ui/layout/analysis/AnalysisRunBar";
import { mountComponent } from "../../../react_harness";

/**
 * Footer run bar contract from `.claude/notes/compute-form-design.md`:
 * explicit Run with an accessible verb, and a cancel affordance while a job
 * is in flight. Both are shipped behaviour — these pin them so the compute
 * form rework cannot quietly drop either one.
 */

const CANCEL = '[aria-label="Cancel run"]';

/** The primary action is the only control that is not the cancel button. */
function primaryAction(host: ParentNode): HTMLButtonElement {
  const buttons = Array.from(host.querySelectorAll("button")).filter(
    (button) => !button.matches(CANCEL),
  );
  const primary = buttons[0];
  if (!primary) throw new Error("AnalysisRunBar rendered no primary action");
  return primary;
}

describe("AnalysisRunBar", () => {
  it("cancel affordance renders while running", async () => {
    const { host, cleanup } = await mountComponent(
      <AnalysisRunBar
        onRun={() => undefined}
        onCancel={() => undefined}
        running
        label="Compute RDF"
      />,
    );
    try {
      expect(host.querySelector(CANCEL)).not.toBeNull();
    } finally {
      await cleanup();
    }
  });

  it("run verb is visibly present or labelled", async () => {
    const { host, cleanup } = await mountComponent(
      <AnalysisRunBar onRun={() => undefined} label="Compute RDF" />,
    );
    try {
      const action = primaryAction(host);
      const name =
        action.getAttribute("aria-label") ?? (action.textContent ?? "").trim();
      expect(name).toContain("Compute RDF");
    } finally {
      await cleanup();
    }
  });
});
