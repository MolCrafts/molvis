/**
 * Edge rail panel — pull open from bottom / left / right.
 *
 * Domain-free block for molcrafts-ui. Products supply chrome (tabs, close)
 * via `header` and content via `children`. Same interaction model as workbench
 * side rails: hairline handle, drag to resize, snap closed below threshold.
 */

import type { JSX, ReactNode, PointerEvent as ReactPointerEvent } from "react";
import { useCallback, useEffect, useRef } from "react";
import { type DragOrigin, usePointerDrag } from "@/hooks/usePointerDrag";
import { cn } from "@/lib/utils";

export type EdgeSide = "bottom" | "left" | "right";

export interface EdgePanelProps {
  side: EdgeSide;
  /** Committed open state. */
  open: boolean;
  /** Committed size along the open axis (px). */
  size: number;
  minSize?: number;
  /** Max size in px; if omitted, uses maxSizeRatio of the viewport. */
  maxSize?: number;
  /** Fraction of viewport used when maxSize is omitted (default 0.55). */
  maxSizeRatio?: number;
  /** Size used when opening from a click on the closed handle. */
  defaultSize?: number;
  /** Close when released size &lt; minSize * this (default 0.55). */
  closeThresholdRatio?: number;
  /** Pixel movement from closed that still counts as click-to-open. */
  clickOpenSlopPx?: number;
  /** Keyboard resize step (default 16). */
  keyboardStepPx?: number;
  onOpenChange: (open: boolean) => void;
  onSizeChange: (size: number) => void;
  /** Optional header band (tabs, title, close). Hidden when closed. */
  header?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Extra classes on the drag handle (product grip tokens). */
  handleClassName?: string;
  /** a11y: open / resize labels */
  openLabel?: string;
  resizeLabel?: string;
  /**
   * When closed, still keep a thin handle so the user can pull open.
   * Default true for bottom; left/right typically false (other chrome opens them).
   */
  showHandleWhenClosed?: boolean;
}

function viewportMax(ratio: number, side: EdgeSide): number {
  if (typeof window === "undefined") return 480;
  const dim = side === "bottom" ? window.innerHeight : window.innerWidth;
  return Math.round(dim * ratio);
}

/**
 * Pull-from-edge panel. Lives in the document flow for `bottom`
 * (pushes layout); `left`/`right` are absolute overlays on a relative parent.
 */
export function EdgePanel({
  side,
  open,
  size,
  minSize = 100,
  maxSize,
  maxSizeRatio = 0.55,
  defaultSize = 220,
  closeThresholdRatio = 0.55,
  clickOpenSlopPx = 6,
  keyboardStepPx = 16,
  onOpenChange,
  onSizeChange,
  header,
  children,
  className,
  handleClassName,
  openLabel = "Open panel",
  resizeLabel = "Resize panel",
  showHandleWhenClosed = side === "bottom",
}: EdgePanelProps): JSX.Element | null {
  const bodyRef = useRef<HTMLDivElement>(null);
  const chromeRef = useRef<HTMLDivElement>(null);
  const sizeRef = useRef(size);
  const openRef = useRef(open);
  const startSizeRef = useRef(0);

  useEffect(() => {
    sizeRef.current = size;
  }, [size]);
  useEffect(() => {
    openRef.current = open;
  }, [open]);

  const maxPx = maxSize ?? viewportMax(maxSizeRatio, side);
  const closePx = minSize * closeThresholdRatio;

  const clamp = useCallback(
    (px: number) => Math.min(maxPx, Math.max(0, px)),
    [maxPx],
  );

  const paint = useCallback(
    (next: number, isOpen: boolean) => {
      sizeRef.current = next;
      openRef.current = isOpen;
      const body = bodyRef.current;
      const chrome = chromeRef.current;
      if (side === "bottom") {
        if (body) body.style.height = isOpen ? `${Math.max(next, 0)}px` : "0px";
      } else {
        if (body) body.style.width = isOpen ? `${Math.max(next, 0)}px` : "0px";
      }
      if (chrome) {
        chrome.hidden = !isOpen;
        chrome.style.display = isOpen ? "" : "none";
      }
    },
    [side],
  );

  // Sync committed props when not mid-drag.
  useEffect(() => {
    paint(size, open);
  }, [size, open, paint]);

  const deltaFromOrigin = (event: PointerEvent, origin: DragOrigin) => {
    if (side === "bottom") return origin.y - event.clientY; // up = grow
    if (side === "left") return event.clientX - origin.x; // right = grow
    return origin.x - event.clientX; // left edge of right panel: left = grow
  };

  const { onPointerDown, dragging } = usePointerDrag({
    onMove: (event, origin) => {
      const raw = startSizeRef.current + deltaFromOrigin(event, origin);
      if (raw < closePx) {
        paint(sizeRef.current || defaultSize, false);
        return;
      }
      paint(clamp(Math.max(minSize, raw)), true);
    },
    onEnd: (event, origin) => {
      const start = startSizeRef.current;
      const delta = deltaFromOrigin(event, origin);
      const raw = start + delta;

      if (start <= 0 && Math.abs(delta) < clickOpenSlopPx) {
        onOpenChange(true);
        onSizeChange(defaultSize);
        paint(defaultSize, true);
        return;
      }
      if (raw < closePx) {
        onOpenChange(false);
        paint(sizeRef.current || defaultSize, false);
        return;
      }
      const next = clamp(Math.max(minSize, raw));
      onOpenChange(true);
      onSizeChange(next);
      paint(next, true);
    },
  });

  const beginResize = (event: ReactPointerEvent) => {
    startSizeRef.current = openRef.current ? sizeRef.current : 0;
    onPointerDown(event);
  };

  const onHandleKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (!open) {
        onOpenChange(true);
        onSizeChange(size < minSize ? defaultSize : size);
        paint(size < minSize ? defaultSize : size, true);
      }
      return;
    }
    if (!open) return;

    const growKey =
      side === "bottom"
        ? "ArrowUp"
        : side === "left"
          ? "ArrowRight"
          : "ArrowLeft";
    const shrinkKey =
      side === "bottom"
        ? "ArrowDown"
        : side === "left"
          ? "ArrowLeft"
          : "ArrowRight";

    if (e.key === growKey) {
      e.preventDefault();
      const next = clamp(sizeRef.current + keyboardStepPx);
      onSizeChange(next);
      paint(next, true);
    } else if (e.key === shrinkKey) {
      e.preventDefault();
      const next = sizeRef.current - keyboardStepPx;
      if (next < closePx) {
        onOpenChange(false);
        paint(sizeRef.current || defaultSize, false);
      } else {
        const clamped = clamp(Math.max(minSize, next));
        onSizeChange(clamped);
        paint(clamped, true);
      }
    }
  };

  if (!open && !showHandleWhenClosed) {
    return null;
  }

  const isHorizontal = side === "bottom";
  const handle = (
    <hr
      aria-orientation={isHorizontal ? "horizontal" : "vertical"}
      aria-valuenow={open ? size : 0}
      aria-valuemin={0}
      aria-valuemax={maxPx}
      aria-label={open ? resizeLabel : openLabel}
      tabIndex={0}
      data-resizing={dragging ? "true" : undefined}
      data-slot="edge-panel-handle"
      data-side={side}
      className={cn(
        "z-10 touch-none select-none border-0 bg-border outline-none",
        "hover:bg-accent/80 data-[resizing=true]:bg-accent",
        isHorizontal && "h-px w-full cursor-row-resize",
        !isHorizontal && "h-full w-px cursor-col-resize",
        !open && isHorizontal && "h-1",
        !open && !isHorizontal && "w-1",
        handleClassName,
      )}
      onPointerDown={beginResize}
      onKeyDown={onHandleKeyDown}
    />
  );

  const bodyStyle =
    side === "bottom"
      ? { height: open ? size : 0 }
      : { width: open ? size : 0 };

  const shell =
    side === "bottom"
      ? "flex shrink-0 flex-col bg-background"
      : side === "left"
        ? "absolute inset-y-0 left-0 z-10 flex flex-row bg-background"
        : "absolute inset-y-0 right-0 z-10 flex flex-row-reverse bg-background";

  return (
    <div
      className={cn(shell, className)}
      data-slot="edge-panel"
      data-side={side}
      data-state={open ? "open" : "closed"}
    >
      {handle}
      {header ? (
        <div
          ref={chromeRef}
          hidden={!open}
          data-slot="edge-panel-header"
          className="flex shrink-0 items-center"
          style={open ? undefined : { display: "none" }}
        >
          {header}
        </div>
      ) : (
        <div ref={chromeRef} hidden className="hidden" />
      )}
      <div
        ref={bodyRef}
        data-slot="edge-panel-body"
        className="min-h-0 min-w-0 overflow-hidden"
        style={bodyStyle}
      >
        {(open || dragging) && children}
      </div>
    </div>
  );
}
