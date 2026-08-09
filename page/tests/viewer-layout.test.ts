import { describe, expect, it } from "@rstest/core";
import {
  CANVAS_MIN_PCT,
  isSidePanelOpen,
  resolveViewerPanelLayout,
  SIDE_PANEL,
  SIDE_PANEL_MAX_PCT,
  SIDE_PANEL_MIN_PCT,
  SIDE_PANEL_OPEN_DEFAULT_PCT,
} from "../src/lib/viewer-layout";

describe("wide viewer panel layout", () => {
  it("uses unified SIDE_PANEL tokens for left and right rails", () => {
    expect(SIDE_PANEL_MIN_PCT).toBe(SIDE_PANEL.minPct);
    expect(SIDE_PANEL_MAX_PCT).toBe(SIDE_PANEL.maxPct);
    expect(SIDE_PANEL_OPEN_DEFAULT_PCT).toBe(SIDE_PANEL.openDefaultPct);
    expect(SIDE_PANEL.minPct).toBe(15);
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
});
