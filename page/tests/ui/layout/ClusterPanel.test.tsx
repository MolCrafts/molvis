import { describe, expect, it } from "@rstest/core";
import { ClusterPanel } from "../../../src/ui/layout/ClusterPanel";
import { mountComponent } from "../../react_harness";
import { readEmptyState, tutorialCopyIn } from "./empty_state_probe";

/**
 * Empty = title only (`.claude/notes/compute-form-design.md`, spec ac-002).
 * `app: null` is the panel's idle contract — both effects return early, so no
 * pipeline, frame, or molrs block is touched.
 */

const TUTORIAL_COPY = ["Run to write cluster mask and color the scene."];

describe("ClusterPanel", () => {
  it("shows a title-only empty state before the first run", async () => {
    const { host, cleanup } = await mountComponent(<ClusterPanel app={null} />);
    try {
      const empty = readEmptyState(host);
      expect({
        title: empty?.title ?? null,
        descriptions: empty?.descriptions ?? null,
        tutorialCopy: tutorialCopyIn(host, TUTORIAL_COPY),
      }).toEqual({
        title: "No clusters yet",
        descriptions: [],
        tutorialCopy: [],
      });
    } finally {
      await cleanup();
    }
  });
});
