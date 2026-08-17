import { describe, expect, it } from "@rstest/core";
import { MsdPanel } from "../../../../src/ui/layout/analysis/MsdPanel";
import { mountComponent } from "../../../react_harness";
import { readEmptyState, tutorialCopyIn } from "../empty_state_probe";

/**
 * Empty = title only (`.claude/notes/compute-form-design.md`, spec ac-002).
 * `app: null` is the panel's own idle contract: every effect returns early, so
 * this renders the pre-first-run state with no worker and no molrs.
 */

const TUTORIAL_COPY = [
  "Pick atoms and run mean-squared displacement over the scope.",
];

describe("MsdPanel", () => {
  it("shows a title-only empty state before the first run", async () => {
    const { host, cleanup } = await mountComponent(
      <MsdPanel app={null} frameRange={{}} trajectoryLength={5} />,
    );
    try {
      const empty = readEmptyState(host);
      expect({
        title: empty?.title ?? null,
        descriptions: empty?.descriptions ?? null,
        tutorialCopy: tutorialCopyIn(host, TUTORIAL_COPY),
      }).toEqual({
        title: "No MSD yet",
        descriptions: [],
        tutorialCopy: [],
      });
    } finally {
      await cleanup();
    }
  });
});
