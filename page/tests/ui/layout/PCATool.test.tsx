import type { Molvis } from "@molcrafts/molvis-stage";
import { describe, expect, it } from "@rstest/core";
import { PCATool } from "../../../src/ui/layout/PCATool";
import { mountComponent } from "../../react_harness";
import { readEmptyState, tutorialCopyIn } from "./empty_state_probe";

/**
 * Empty = title only (`.claude/notes/compute-form-design.md`, spec ac-002).
 */

const MAP_TUTORIAL_COPY = [
  "Select descriptors and run PCA to project frames into 2D.",
];
const LABELS_TUTORIAL_COPY = [
  "Load an ExtXYZ trajectory with key=value properties in comment lines to run PCA.",
];

interface FakeSystem {
  readonly frameLabels: Map<string, Float64Array> | null;
  readonly exploration: null;
}

interface FakeMolvis {
  readonly system: FakeSystem;
  readonly events: { on: (event: string) => () => void };
}

/**
 * Labelled frames, no PCA result: the panel's idle state. Only `frameLabels`,
 * `exploration`, and the two label/exploration subscriptions are read before
 * the first run — the scatter controller stays null without a result, so no
 * chart, no molplot, no trajectory.
 */
function labelledApp(): Molvis {
  const fake: FakeMolvis = {
    system: {
      frameLabels: new Map([
        ["energy", new Float64Array([-1.5, -1.2, -1.9])],
        ["temperature", new Float64Array([300, 305, 310])],
      ]),
      exploration: null,
    },
    events: { on: () => () => undefined },
  };
  return fake as unknown as Molvis;
}

describe("PCATool", () => {
  it("shows a title-only empty state before the first run", async () => {
    const { host, cleanup } = await mountComponent(
      <PCATool app={labelledApp()} />,
    );
    try {
      const empty = readEmptyState(host);
      expect({
        title: empty?.title ?? null,
        descriptions: empty?.descriptions ?? null,
        tutorialCopy: tutorialCopyIn(host, MAP_TUTORIAL_COPY),
      }).toEqual({
        title: "No map yet",
        descriptions: [],
        tutorialCopy: [],
      });
    } finally {
      await cleanup();
    }
  });

  it("shows a title-only empty state when no frame labels exist", async () => {
    // The requirement is already spelled out by the run-bar hint ("Load ExtXYZ
    // with key=value comment properties"), so the empty state repeats it as a
    // tutorial paragraph. Title wording is the implementer's call; only the
    // paragraph is pinned.
    const { host, cleanup } = await mountComponent(<PCATool app={null} />);
    try {
      const empty = readEmptyState(host);
      expect({
        descriptions: empty?.descriptions ?? null,
        tutorialCopy: tutorialCopyIn(host, LABELS_TUTORIAL_COPY),
      }).toEqual({
        descriptions: [],
        tutorialCopy: [],
      });
    } finally {
      await cleanup();
    }
  });
});
