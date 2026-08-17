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

/** @deprecated Prefer {@link SIDE_PANEL.minPct} — kept as stable export alias. */
export const SIDE_PANEL_MIN_PCT = SIDE_PANEL.minPct;
/** @deprecated Prefer {@link SIDE_PANEL.maxPct}. */
export const SIDE_PANEL_MAX_PCT = SIDE_PANEL.maxPct;
/** @deprecated Prefer {@link SIDE_PANEL.openDefaultPct}. */
export const SIDE_PANEL_OPEN_DEFAULT_PCT = SIDE_PANEL.openDefaultPct;

/**
 * Middle canvas floor when any side rail is present (% of page).
 * Derived: one rail at {@link SIDE_PANEL.maxPct} still leaves this much canvas.
 * Equals the minimum gap between left and right rails when both are open
 * (they share the remaining `100 - CANVAS_MIN_PCT`).
 */
export const CANVAS_MIN_PCT = 100 - SIDE_PANEL.maxPct;

function pct(n: number): string {
  return `${n}%`;
}

/**
 * Compute keeps a zero-width resizable slot so it can be pulled out from the
 * left edge without remounting; tools open at {@link SIDE_PANEL.openDefaultPct}.
 */
export function resolveViewerPanelLayout({
  showCompute,
  showTools,
}: ViewerPanelVisibility): ViewerPanelLayout {
  const open = SIDE_PANEL.openDefaultPct;
  const canvasWithTools = 100 - open;

  if (showCompute && showTools) {
    return {
      defaultLayout: { compute: 0, canvas: canvasWithTools, tools: open },
      computeSize: pct(0),
      canvasSize: pct(canvasWithTools),
      toolsSize: pct(open),
    };
  }
  if (showCompute) {
    return {
      defaultLayout: { compute: 0, canvas: 100 },
      computeSize: pct(0),
      canvasSize: pct(100),
      toolsSize: pct(0),
    };
  }
  if (showTools) {
    return {
      defaultLayout: { canvas: canvasWithTools, tools: open },
      computeSize: pct(0),
      canvasSize: pct(canvasWithTools),
      toolsSize: pct(open),
    };
  }
  return {
    defaultLayout: { canvas: 100 },
    computeSize: pct(0),
    canvasSize: pct(100),
    toolsSize: pct(0),
  };
}

export function isSidePanelOpen(pctValue: number): boolean {
  return pctValue >= SIDE_PANEL.minPct;
}

// ---------------------------------------------------------------------------
// Drag-resized horizontal splits
// ---------------------------------------------------------------------------

/**
 * Shared limits for panels the user drags to resize.
 *
 * The pipeline properties pane and the workbench bottom panel keep separate
 * interaction models (window listeners vs pointer capture, snap-close vs
 * not), but they had also each re-typed these three numbers. One drifting
 * copy is enough for two panels to stop agreeing on how small "too small" is.
 */
export const RESIZE_MIN_HEIGHT_PX = 100;

/** Fraction of the container a drag-resized panel may occupy. */
export const RESIZE_MAX_HEIGHT_RATIO = 0.55;

/** Height step for ArrowUp / ArrowDown on a resize handle. */
export const RESIZE_KEYBOARD_STEP_PX = 16;

/**
 * Largest height a drag-resized panel may take inside `containerHeight`.
 * Never below {@link RESIZE_MIN_HEIGHT_PX}, so a short container still
 * yields a usable panel rather than a zero-height sliver.
 */
export function maxResizeHeight(containerHeight: number): number {
  return Math.max(
    RESIZE_MIN_HEIGHT_PX,
    Math.floor(containerHeight * RESIZE_MAX_HEIGHT_RATIO),
  );
}

/** Clamp a dragged height into `[min, maxResizeHeight(containerHeight)]`. */
export function clampResizeHeight(
  desired: number,
  containerHeight: number,
  minHeight: number = RESIZE_MIN_HEIGHT_PX,
): number {
  const maxH = maxResizeHeight(containerHeight);
  return Math.max(Math.min(minHeight, maxH), Math.min(desired, maxH));
}
