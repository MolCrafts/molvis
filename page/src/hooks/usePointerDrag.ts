import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";

/** Where a drag started, in client coordinates. */
export interface DragOrigin {
  x: number;
  y: number;
  pointerId: number;
}

export interface PointerDragOptions {
  /** Fires for every move while the drag is in flight. */
  onMove: (event: PointerEvent, origin: DragOrigin) => void;
  /**
   * Fires once when the pointer is released or the gesture is cancelled.
   * `event` is the pointerup/pointercancel that ended it.
   */
  onEnd?: (event: PointerEvent, origin: DragOrigin) => void;
}

export interface PointerDrag {
  /** Attach to the drag handle. */
  onPointerDown: (event: React.PointerEvent) => void;
  /** True while a drag is in flight — for cursor / `data-resizing` chrome. */
  dragging: boolean;
}

/**
 * The pointer-drag gesture, without any opinion about what is being dragged.
 *
 * The pipeline properties divider and the workbench bottom panel each had
 * their own copy of this: capture the pointer, follow moves, release and
 * clean up on up/cancel, expose a `dragging` flag. What they legitimately
 * disagree about is everything *downstream* — one stores a ratio of its
 * container, the other pixels against the viewport; one snaps closed below a
 * threshold, the other never closes. So this hook deliberately reports raw
 * events and the drag origin, and does no clamping, no unit conversion and
 * no commit policy. Adding options for those would make the configuration
 * larger than the logic and put both callers' behaviour in one place where
 * neither is obvious.
 *
 * Capture is what makes the drag survive the cursor leaving the handle;
 * window listeners then still see the events, and are used so a release
 * outside the window still ends the gesture.
 */
export function usePointerDrag({
  onMove,
  onEnd,
}: PointerDragOptions): PointerDrag {
  const [dragging, setDragging] = useState(false);
  const originRef = useRef<DragOrigin | null>(null);
  // Keep the latest callbacks without re-subscribing listeners mid-drag.
  const onMoveRef = useRef(onMove);
  const onEndRef = useRef(onEnd);
  onMoveRef.current = onMove;
  onEndRef.current = onEnd;

  useEffect(() => {
    if (!dragging) return;

    const handleMove = (event: PointerEvent) => {
      const origin = originRef.current;
      if (!origin || event.pointerId !== origin.pointerId) return;
      onMoveRef.current(event, origin);
    };

    const handleEnd = (event: PointerEvent) => {
      const origin = originRef.current;
      if (!origin || event.pointerId !== origin.pointerId) return;
      originRef.current = null;
      setDragging(false);
      onEndRef.current?.(event, origin);
    };

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleEnd);
    window.addEventListener("pointercancel", handleEnd);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleEnd);
      window.removeEventListener("pointercancel", handleEnd);
    };
  }, [dragging]);

  const onPointerDown = useCallback((event: React.PointerEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    originRef.current = {
      x: event.clientX,
      y: event.clientY,
      pointerId: event.pointerId,
    };
    setDragging(true);
  }, []);

  return { onPointerDown, dragging };
}
