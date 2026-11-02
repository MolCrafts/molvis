/**
 * MolVis aliases over the shared workbench geometry.
 *
 * Tokens and helpers live in `layout.ts` (synced from molcrafts-ui).
 * This file keeps compute/tools names so existing tests and App.tsx
 * imports stay stable until App mounts WorkbenchShell.
 */

export {
  CANVAS_MIN_PCT,
  COARSE_POINTER_INLINE_PANEL_BREAKPOINT,
  clampResizeHeight,
  INLINE_PANEL_BREAKPOINT,
  isSidePanelOpen,
  maxResizeHeight,
  RESIZE_KEYBOARD_STEP_PX,
  RESIZE_MAX_HEIGHT_RATIO,
  RESIZE_MIN_HEIGHT_PX,
  resolveWorkbenchPanelLayout,
  SIDE_PANEL,
  SIDE_PANEL_MIN_PX,
  SIDE_PANEL_MIN_TRAVEL_PCT,
  sidePanelMaxPct,
  sidePanelMinPct,
} from "./layout";

import { resolveWorkbenchPanelLayout, SIDE_PANEL } from "./layout";

export interface ViewerPanelVisibility {
  showCompute: boolean;
  showTools: boolean;
}

export interface ViewerPanelLayout {
  defaultLayout: Record<string, number>;
  computeSize: string;
  canvasSize: string;
  toolsSize: string;
}

/**
 * Unified side-rail geometry (**left compute = right tools**).
 * All values are **page-width percentages** for the horizontal ResizablePanel
 * group — one token set, never left/right-specific widths.
 *
 * | token | role |
 * |-------|------|
 * | `minPct` | open floor + snap-close threshold |
 * | `maxPct` | drag ceiling for one rail |
 * | `openDefaultPct` | first open / default tools width |
 */
export const SIDE_PANEL = {
  /** Narrowest useful open rail (% of page). */
  minPct: 15,
  /** Widest one rail may grow (% of page). */
  maxPct: 30,
  /** Default open width when expanding a collapsed rail (% of page). */
  openDefaultPct: 15,
} as const;

/**
 * Narrowest usable compute rail in **pixels**.
 *
 * `.claude/notes/compute-form-design.md` designs every compute form for a
 * 240–320px rail. {@link SIDE_PANEL.minPct} alone cannot hold that floor: 15%
 * of a 1280px laptop is 192px, so the forms would render 48px narrower than
 * they are designed for. Percentages stay the layout language;
 * {@link sidePanelMinPct} converts this floor into them.
 */
export const SIDE_PANEL_MIN_PX = 240;

/**
 * Rail minimum for a container of `containerWidth` px, as a page percentage.
 *
 * Whichever floor is stricter wins: {@link SIDE_PANEL.minPct} on wide screens
 * (where 240px is already covered), the {@link SIDE_PANEL_MIN_PX} equivalent on
 * narrower ones. Never above {@link SIDE_PANEL.maxPct}, so the returned minimum
 * can always be paired with that maximum. An unmeasured container (0 before the
 * first `ResizeObserver` callback) falls back to the percentage floor.
 */
export function sidePanelMinPct(containerWidth: number): number {
  if (!Number.isFinite(containerWidth) || containerWidth <= 0) {
    return SIDE_PANEL.minPct;
  }
  // Round up at the hundredth so the resolved percentage never lands a
  // fraction of a pixel under the floor.
  const pxFloorPct =
    Math.ceil((SIDE_PANEL_MIN_PX / containerWidth) * 1e4) / 100;
  return Math.min(SIDE_PANEL.maxPct, Math.max(SIDE_PANEL.minPct, pxFloorPct));
}

/**
 * Narrowest drag range a rail must keep, as a page percentage.
 *
 * Without a floor here the rail becomes unresizable on a small screen: the
 * 240px form floor reaches {@link SIDE_PANEL.maxPct} at a 800px container, so
 * `sidePanelMinPct` and the fixed 30% cap meet and the splitter has nowhere to
 * travel (at 900px the whole range is ~30px). The cap is what gives — a rail
 * the user is actively dragging is a rail they want wider.
 */
export const SIDE_PANEL_MIN_TRAVEL_PCT = 10;

/**
 * Widest a rail may grow for a container of `containerWidth` px.
 *
 * {@link SIDE_PANEL.maxPct} on screens wide enough for it, otherwise whatever
 * keeps {@link SIDE_PANEL_MIN_TRAVEL_PCT} of travel above
 * {@link sidePanelMinPct}. Pair it with that function — never with the raw
 * constant — or narrow screens get min === max.
 */
export function sidePanelMaxPct(containerWidth: number): number {
  return Math.max(
    SIDE_PANEL.maxPct,
    sidePanelMinPct(containerWidth) + SIDE_PANEL_MIN_TRAVEL_PCT,
  );
}

/**
 * Compute keeps a zero-width resizable slot so it can be pulled out from the
 * left edge without remounting; tools open at {@link SIDE_PANEL.openDefaultPct}.
 */
export function resolveViewerPanelLayout({
  showCompute,
  showTools,
}: ViewerPanelVisibility): ViewerPanelLayout {
  const resolved = resolveWorkbenchPanelLayout({
    showLeft: showCompute,
    showRight: showTools,
    leftOpen: false,
    rightOpen: showTools,
  });
  const defaultLayout: Record<string, number> = {
    canvas: resolved.defaultLayout.canvas,
  };
  if (showCompute) defaultLayout.compute = resolved.defaultLayout.left ?? 0;
  if (showTools) defaultLayout.tools = resolved.defaultLayout.right ?? 0;
  return {
    defaultLayout,
    computeSize: resolved.leftSize,
    canvasSize: resolved.canvasSize,
    toolsSize: resolved.rightSize,
  };
}
