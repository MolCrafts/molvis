/**
 * Shared workbench geometry. Every MolCrafts product uses this shell.
 *
 * Source of truth for the iron rule: left rail, canvas, and right rail share
 * one token set — never product-specific widths. Lifted from MolVis 0.3.0
 * `page/src/lib/viewer-layout.ts`.
 */

export const SIDE_PANEL = {
  /** Narrowest useful open rail (% of page). 30% under the previous 15%. */
  minPct: 10.5,
  /** Widest one rail may grow (% of page) on a wide shell. */
  maxPct: 30,
  /** Default open width when expanding a collapsed rail (% of page). */
  openDefaultPct: 10.5,
} as const;

/** Narrowest usable side rail in pixels (compute / data / inspector forms). */
export const SIDE_PANEL_MIN_PX = 168;

/**
 * Narrowest drag range a rail must keep, as a page percentage.
 *
 * Without a floor here the rail becomes unresizable on a small screen: the
 * 168px form floor reaches {@link SIDE_PANEL.maxPct} at a 560px container, so
 * `sidePanelMinPct` and the fixed 30% cap meet and the splitter has nowhere to
 * travel. The cap is what gives — a rail the user is actively dragging is a
 * rail they want wider.
 */
export const SIDE_PANEL_MIN_TRAVEL_PCT = 10;

/** Canvas floor when any side rail is present (% of page). */
export const CANVAS_MIN_PCT = 100 - SIDE_PANEL.maxPct;

/** Toolbar height in px — `h-toolbar` / `--spacing-toolbar` (2.75rem). */
export const TOOLBAR_HEIGHT_PX = 44;

/** Compact icon-only control — `size-control-compact` (1.75rem). */
export const ICON_BUTTON_SIZE_PX = 28;

/** Status bar height — `--spacing-statusbar`. */
export const STATUSBAR_HEIGHT_PX = 28;

/**
 * Container width (px) below which inline rails become edge drawers.
 * Measured on the shell, not the viewport — embeds are often narrower.
 */
export const INLINE_PANEL_BREAKPOINT = 1280;

/** Coarse-pointer hosts need more canvas; drawers kick in earlier. */
export const COARSE_POINTER_INLINE_PANEL_BREAKPOINT = 1580;

/**
 * Rail minimum for a container of `containerWidth` px, as a page percentage.
 *
 * Whichever floor is stricter wins: {@link SIDE_PANEL.minPct} on wide screens
 * (where 168px is already covered), the {@link SIDE_PANEL_MIN_PX} equivalent on
 * narrower ones. Never above {@link SIDE_PANEL.maxPct}, so the returned minimum
 * can always be paired with that maximum. An unmeasured container (0 before the
 * first `ResizeObserver` callback) falls back to the percentage floor.
 */
export function sidePanelMinPct(containerWidth: number): number {
  if (!Number.isFinite(containerWidth) || containerWidth <= 0) {
    return SIDE_PANEL.minPct;
  }
  const pxFloorPct =
    Math.ceil((SIDE_PANEL_MIN_PX / containerWidth) * 1e4) / 100;
  return Math.min(SIDE_PANEL.maxPct, Math.max(SIDE_PANEL.minPct, pxFloorPct));
}

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

export function isSidePanelOpen(pctValue: number): boolean {
  return pctValue >= SIDE_PANEL.minPct;
}

export interface WorkbenchPanelVisibility {
  showLeft: boolean;
  showRight: boolean;
  leftOpen?: boolean;
  rightOpen?: boolean;
}

export interface WorkbenchPanelLayout {
  defaultLayout: Record<string, number>;
  leftSize: string;
  canvasSize: string;
  rightSize: string;
}

function pct(n: number): string {
  return `${n}%`;
}

/**
 * Default percentages for the horizontal group.
 *
 * Closed-but-present rails are `0%` slots so the hairline handle still exists.
 * Open size is {@link SIDE_PANEL.openDefaultPct} — last-dragged width is a
 * runtime concern of `WorkbenchShell`, not this helper.
 */
export function resolveWorkbenchPanelLayout({
  showLeft,
  showRight,
  leftOpen = true,
  rightOpen = true,
}: WorkbenchPanelVisibility): WorkbenchPanelLayout {
  const open = SIDE_PANEL.openDefaultPct;
  const left = showLeft && leftOpen ? open : 0;
  const right = showRight && rightOpen ? open : 0;
  const canvas = 100 - (showLeft ? left : 0) - (showRight ? right : 0);

  const defaultLayout: Record<string, number> = { canvas };
  if (showLeft) defaultLayout.left = left;
  if (showRight) defaultLayout.right = right;

  return {
    defaultLayout,
    leftSize: pct(showLeft ? left : 0),
    canvasSize: pct(canvas),
    rightSize: pct(showRight ? right : 0),
  };
}

/** Shared limits for panels the user drags to resize (bottom rail, etc.). */
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
