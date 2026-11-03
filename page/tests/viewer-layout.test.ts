import { describe, expect, it } from "@rstest/core";
import * as viewerLayout from "../src/lib/viewer-layout";
import {
  CANVAS_MIN_PCT,
  isSidePanelOpen,
  resolveViewerPanelLayout,
  SIDE_PANEL,
  SIDE_PANEL_MAX_PCT,
  SIDE_PANEL_MIN_PCT,
  SIDE_PANEL_MIN_TRAVEL_PCT,
  SIDE_PANEL_OPEN_DEFAULT_PCT,
  sidePanelMaxPct,
  sidePanelMinPct,
} from "../src/lib/viewer-layout";

describe("wide viewer panel layout", () => {
  it("uses unified SIDE_PANEL tokens for left and right rails", () => {
    expect(SIDE_PANEL_MIN_PCT).toBe(SIDE_PANEL.minPct);
    expect(SIDE_PANEL_MAX_PCT).toBe(SIDE_PANEL.maxPct);
    expect(SIDE_PANEL_OPEN_DEFAULT_PCT).toBe(SIDE_PANEL.openDefaultPct);
    expect(SIDE_PANEL.minPct).toBe(10.5);
    expect(SIDE_PANEL.maxPct).toBe(30);
    expect(SIDE_PANEL.openDefaultPct).toBeGreaterThanOrEqual(SIDE_PANEL.minPct);
    expect(SIDE_PANEL.openDefaultPct).toBeLessThanOrEqual(SIDE_PANEL.maxPct);
    // Canvas floor = remainder after one rail at max.
    expect(CANVAS_MIN_PCT).toBe(100 - SIDE_PANEL.maxPct);
    expect(CANVAS_MIN_PCT).toBe(70);
  });

  it("starts Compute collapsed while retaining space for the right tool panel", () => {
    const layout = resolveViewerPanelLayout({
      showCompute: true,
      showTools: true,
    });
    const open = SIDE_PANEL.openDefaultPct;
    const canvas = 100 - open;

    expect(layout.defaultLayout).toEqual({
      compute: 0,
      canvas,
      tools: open,
    });
    expect(layout.computeSize).toBe("0%");
    expect(layout.canvasSize).toBe(`${canvas}%`);
    expect(layout.toolsSize).toBe(`${open}%`);
  });

  it("treats widths below the minimum as closed", () => {
    expect(isSidePanelOpen(0)).toBe(false);
    expect(isSidePanelOpen(SIDE_PANEL.minPct - 1)).toBe(false);
    expect(isSidePanelOpen(SIDE_PANEL.minPct)).toBe(true);
    expect(isSidePanelOpen(SIDE_PANEL.openDefaultPct)).toBe(true);
  });

  /**
   * `.claude/notes/compute-form-design.md` designs the compute rail for
   * 168–224px (30% under the previous 240–320px floor). A pure percentage
   * floor breaks that on ordinary laptops: `minPct: 10.5` of a 1280px window
   * is 134px, so the form the note specifies for 168px is narrower than designed.
   *
   * Minimal intended API, matching this module's existing
   * `RESIZE_MIN_HEIGHT_PX` + `maxResizeHeight(container)` shape: one px
   * constant plus one container-aware clamp that returns the same percentage
   * the ResizablePanel group already speaks.
   *
   * Read through the module namespace on purpose — a missing named import
   * would fail the whole file at build time and take the passing tests above
   * with it, hiding which rule actually broke.
   */
  interface PxFloorSurface {
    SIDE_PANEL_MIN_PX: number;
    sidePanelMinPct: (containerWidth: number) => number;
  }

  const pxFloor = viewerLayout as unknown as Partial<PxFloorSurface>;

  it("holds the left rail to a 168px pixel floor", () => {
    expect(pxFloor.SIDE_PANEL_MIN_PX).toBe(168);
  });

  it("resolves the rail minimum in px terms for the container", () => {
    const minPct = pxFloor.sidePanelMinPct;
    if (typeof minPct !== "function") {
      throw new Error(
        "viewer-layout exports no sidePanelMinPct(containerWidth) resolver",
      );
    }
    // 1280px laptop: 10.5% is 134px, below the design floor.
    expect((minPct(1280) / 100) * 1280).toBeGreaterThanOrEqual(168);
    // A wide window needs no px rescue — the percentage floor still rules.
    expect(minPct(3000)).toBe(SIDE_PANEL.minPct);
  });
});

describe("sidePanelMaxPct", () => {
  /**
   * The 168px form floor reaches the 30% cap at a 560px shell, so pairing
   * `sidePanelMinPct` with the raw constant left the splitter with no travel —
   * "the rails cannot be dragged open on a small screen".
   */
  it("keeps the cap on a shell wide enough for it", () => {
    expect(sidePanelMaxPct(1600)).toBe(SIDE_PANEL.maxPct);
    expect(sidePanelMinPct(1600)).toBeLessThan(sidePanelMaxPct(1600));
  });

  it("guarantees drag travel where the px floor meets the cap", () => {
    for (const width of [400, 600, 800, 900, 1024, 1280, 1600, 2560]) {
      // Compared at the module's own hundredth-of-a-percent precision:
      // 36.67 - 26.67 is 9.999999999999996 in binary floating point.
      const travel =
        Math.round((sidePanelMaxPct(width) - sidePanelMinPct(width)) * 100) /
        100;
      expect(travel).toBeGreaterThanOrEqual(SIDE_PANEL_MIN_TRAVEL_PCT);
    }
  });

  it("is never below the min for the same width", () => {
    for (const width of [320, 800, 1440]) {
      expect(sidePanelMaxPct(width)).toBeGreaterThan(sidePanelMinPct(width));
    }
  });
});
