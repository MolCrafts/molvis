import { describe, expect, it } from "@rstest/core";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { type DragOrigin, usePointerDrag } from "@/hooks/usePointerDrag";

interface Recorded {
  moves: Array<{ y: number; origin: DragOrigin }>;
  ends: Array<{ y: number; origin: DragOrigin }>;
  dragging: boolean[];
}

/**
 * Mount a handle wired to the hook and return it plus a call log.
 *
 * `setPointerCapture` is stubbed: the real one throws NotFoundError unless
 * the pointerId belongs to a live pointer, which synthetic events have no
 * way to produce.
 */
async function mountHandle(): Promise<{
  handle: HTMLElement;
  log: Recorded;
  cleanup: () => void;
}> {
  const log: Recorded = { moves: [], ends: [], dragging: [] };
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);

  function Probe() {
    const { onPointerDown, dragging } = usePointerDrag({
      onMove: (event, origin) => {
        log.moves.push({ y: event.clientY, origin });
      },
      onEnd: (event, origin) => {
        log.ends.push({ y: event.clientY, origin });
      },
    });
    log.dragging.push(dragging);
    return (
      <button type="button" data-testid="handle" onPointerDown={onPointerDown}>
        handle
      </button>
    );
  }

  await act(async () => {
    root.render(<Probe />);
  });

  const handle = host.querySelector<HTMLElement>("[data-testid=handle]");
  if (!handle) throw new Error("handle did not mount");
  handle.setPointerCapture = () => {};

  return {
    handle,
    log,
    cleanup: () => {
      root.unmount();
      host.remove();
    },
  };
}

function pointer(type: string, init: PointerEventInit): PointerEvent {
  return new PointerEvent(type, { bubbles: true, pointerId: 1, ...init });
}

async function press(handle: HTMLElement, y: number, button = 0) {
  await act(async () => {
    handle.dispatchEvent(pointer("pointerdown", { clientY: y, button }));
  });
}

async function moveTo(y: number) {
  await act(async () => {
    window.dispatchEvent(pointer("pointermove", { clientY: y }));
  });
}

async function release(type: "pointerup" | "pointercancel", y: number) {
  await act(async () => {
    window.dispatchEvent(pointer(type, { clientY: y }));
  });
}

describe("usePointerDrag", () => {
  it("reports moves against the drag origin and ends once on pointerup", async () => {
    const { handle, log, cleanup } = await mountHandle();
    try {
      await press(handle, 100);
      await moveTo(80);
      await moveTo(60);
      await release("pointerup", 60);

      expect(log.moves.map((m) => m.y)).toEqual([80, 60]);
      // Origin stays the press point for the whole gesture — callers derive
      // their own delta from it.
      expect(log.moves.every((m) => m.origin.y === 100)).toBe(true);
      expect(log.ends).toHaveLength(1);
      expect(log.ends[0].origin.y).toBe(100);
      expect(log.dragging.at(-1)).toBe(false);
    } finally {
      cleanup();
    }
  });

  it("stops reporting moves after the gesture ends", async () => {
    const { handle, log, cleanup } = await mountHandle();
    try {
      await press(handle, 100);
      await release("pointerup", 90);
      await moveTo(10);
      expect(log.moves).toHaveLength(0);
      expect(log.ends).toHaveLength(1);
    } finally {
      cleanup();
    }
  });

  it("treats pointercancel as an end", async () => {
    const { handle, log, cleanup } = await mountHandle();
    try {
      await press(handle, 100);
      await moveTo(70);
      await release("pointercancel", 70);
      expect(log.ends).toHaveLength(1);
      expect(log.dragging.at(-1)).toBe(false);
    } finally {
      cleanup();
    }
  });

  it("ignores non-primary buttons", async () => {
    const { handle, log, cleanup } = await mountHandle();
    try {
      await press(handle, 100, 2);
      await moveTo(50);
      expect(log.moves).toHaveLength(0);
      expect(log.dragging.at(-1)).toBe(false);
    } finally {
      cleanup();
    }
  });

  it("ignores events from a different pointer", async () => {
    const { handle, log, cleanup } = await mountHandle();
    try {
      await press(handle, 100);
      await act(async () => {
        window.dispatchEvent(
          pointer("pointermove", { clientY: 40, pointerId: 7 }),
        );
      });
      expect(log.moves).toHaveLength(0);

      // The matching pointer still drives it.
      await moveTo(70);
      expect(log.moves.map((m) => m.y)).toEqual([70]);
    } finally {
      cleanup();
    }
  });
});
