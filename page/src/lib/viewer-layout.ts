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

/** @deprecated Prefer {@link SIDE_PANEL.minPct} — kept as stable export alias. */
export const SIDE_PANEL_MIN_PCT = SIDE_PANEL.minPct;
/** @deprecated Prefer {@link SIDE_PANEL.maxPct}. */
export const SIDE_PANEL_MAX_PCT = SIDE_PANEL.maxPct;
/** @deprecated Prefer {@link SIDE_PANEL.openDefaultPct}. */
export const SIDE_PANEL_OPEN_DEFAULT_PCT = SIDE_PANEL.openDefaultPct;

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
