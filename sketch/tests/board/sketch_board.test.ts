import { describe, expect, it } from "@rstest/core";
import { SketchBoard } from "../../src/board/sketch_board";

function makeCanvas(w = 300, h = 200): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  Object.defineProperty(canvas, "getBoundingClientRect", {
    value: () => ({
      left: 0,
      top: 0,
      width: w,
      height: h,
      right: w,
      bottom: h,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }),
  });
  return canvas;
}

function pointer(
  type: "pointerdown" | "pointermove" | "pointerup" | "pointercancel",
  canvas: HTMLCanvasElement,
  clientX: number,
  clientY: number,
  options: PointerEventInit = {},
) {
  canvas.dispatchEvent(
    new PointerEvent(type, {
      clientX,
      clientY,
      bubbles: true,
      pointerId: 1,
      ...options,
    }),
  );
}

describe("SketchBoard", () => {
  it("starts on the atom tool", () => {
    expect(new SketchBoard().getTool()).toBe("atom");
  });

  it("ignores an empty-paper Chain drag that can make only one segment", async () => {
    const board = new SketchBoard({ bondChainStep: 1 });
    const canvas = makeCanvas();
    board.mount(canvas);
    board.setTool("chain");
    const start = board.viewport.docToScreen(-0.5, 0);
    const end = board.viewport.docToScreen(0.5, 0);
    pointer("pointerdown", canvas, start.x, start.y);
    pointer("pointermove", canvas, end.x, end.y);
    pointer("pointerup", canvas, end.x, end.y);

    expect(board.getMoleculeData()).toEqual({ atoms: [], bonds: [] });
    expect(board.getState().canUndo).toBe(false);
    board.unmount();
  });

  it("routes Chain through a middle carbon when dropped on its canonical endpoint", async () => {
    const board = new SketchBoard({ bondChainStep: 1 });
    const canvas = makeCanvas();
    board.mount(canvas);
    board.loadMoleculeData({
      atoms: [
        { element: "C", x: 0, y: 0 },
        { element: "C", x: Math.sqrt(3), y: 0 },
      ],
      bonds: [],
    });
    board.setTool("chain");
    board.setBondOrder(3);
    const start = board.viewport.docToScreen(0, 0);
    const end = board.viewport.docToScreen(Math.sqrt(3), 0);
    pointer("pointerdown", canvas, start.x, start.y);
    pointer("pointermove", canvas, end.x, end.y);
    pointer("pointerup", canvas, end.x, end.y);

    const data = board.getMoleculeData();
    expect(data.atoms).toHaveLength(3);
    expect(data.bonds).toHaveLength(2);
    expect(data.atoms[2].x).toBeCloseTo(Math.sqrt(3) / 2, 8);
    expect(data.atoms[2].y).toBeCloseTo(0.5, 8);
    expect(
      data.bonds
        .map((bond) => [
          Math.min(bond.i, bond.j),
          Math.max(bond.i, bond.j),
          bond.order,
        ])
        .sort((left, right) => left[0] - right[0]),
    ).toEqual([
      [0, 2, 1],
      [1, 2, 1],
    ]);
    board.unmount();
  });

  it("atom tool places atom on empty click", async () => {
    const board = new SketchBoard();
    const canvas = makeCanvas();
    board.mount(canvas);
    board.setTool("atom");
    board.setElement("O");
    // center of canvas → doc ~ (0,0)
    pointer("pointerdown", canvas, 150, 100);
    expect(board.getMoleculeData().atoms).toHaveLength(1);
    expect(board.getMoleculeData().atoms[0].element).toBe("O");
    board.unmount();
  });

  it("bond tool connects two atoms", async () => {
    const board = new SketchBoard();
    const canvas = makeCanvas();
    board.mount(canvas);
    board.loadMoleculeData({
      atoms: [
        { element: "C", x: 0, y: 0 },
        { element: "O", x: 1.2, y: 0 },
      ],
      bonds: [],
    });
    board.setTool("bond");
    const p0 = board.viewport.docToScreen(0, 0);
    const p1 = board.viewport.docToScreen(1.2, 0);
    pointer("pointerdown", canvas, p0.x, p0.y);
    pointer("pointerup", canvas, p1.x, p1.y);
    expect(board.getMoleculeData().bonds).toHaveLength(1);
    board.unmount();
  });

  it("atom tool replaces an existing atom and undo restores it", async () => {
    const board = new SketchBoard();
    const canvas = makeCanvas();
    board.mount(canvas);
    board.loadMoleculeData({
      atoms: [{ element: "C", x: 0, y: 0 }],
      bonds: [],
    });
    board.setTool("atom");
    board.setElement("N");
    const point = board.viewport.docToScreen(0, 0);
    pointer("pointerdown", canvas, point.x, point.y);
    expect(board.getMoleculeData().atoms[0].element).toBe("N");
    await board.undo();
    expect(board.getMoleculeData().atoms[0].element).toBe("C");
    board.unmount();
  });

  it("bond and chain gestures can start on empty paper as one undo step", async () => {
    const board = new SketchBoard();
    const canvas = makeCanvas();
    board.mount(canvas);
    board.setTool("bond");
    const start = board.viewport.docToScreen(-1, 0);
    const end = board.viewport.docToScreen(1, 0);
    pointer("pointerdown", canvas, start.x, start.y);
    pointer("pointermove", canvas, end.x, end.y);
    pointer("pointerup", canvas, end.x, end.y);
    expect(board.getMoleculeData().atoms).toHaveLength(2);
    expect(board.getMoleculeData().bonds).toHaveLength(1);
    await board.undo();
    expect(board.getMoleculeData()).toEqual({ atoms: [], bonds: [] });

    board.setBondOrder(3);
    board.setTool("chain");
    expect(board.getBondOrder()).toBe(1);
    pointer("pointerdown", canvas, start.x, start.y);
    pointer("pointermove", canvas, end.x, end.y);
    pointer("pointerup", canvas, end.x, end.y);
    expect(board.getMoleculeData().atoms).toHaveLength(3);
    expect(board.getMoleculeData().bonds).toHaveLength(2);
    await board.undo();
    expect(board.getMoleculeData()).toEqual({ atoms: [], bonds: [] });
    board.unmount();
  });

  it("bond empty-drop places one terminal C at fixed length; undo restores", async () => {
    const board = new SketchBoard();
    const canvas = makeCanvas();
    board.mount(canvas);
    board.loadMoleculeData({
      atoms: [{ element: "C", x: 0, y: 0 }],
      bonds: [],
    });
    board.setTool("bond");
    const p0 = board.viewport.docToScreen(0, 0);
    const pEnd = board.viewport.docToScreen(2.4, 0);
    pointer("pointerdown", canvas, p0.x, p0.y);
    pointer("pointerup", canvas, pEnd.x, pEnd.y);
    // Single terminal carbon at ~DEFAULT_BOND_LENGTH (angle-snapped), not free chain
    expect(board.getMoleculeData().atoms).toHaveLength(2);
    expect(board.getMoleculeData().bonds).toHaveLength(1);
    const c1 = board.getMoleculeData().atoms[1];
    expect(Math.hypot(c1.x, c1.y)).toBeCloseTo(1.0, 5);
    await board.undo();
    expect(board.getMoleculeData().atoms).toHaveLength(1);
    board.unmount();
  });

  it("bond drag snaps to nearby atom instead of spawning new carbon", async () => {
    const board = new SketchBoard();
    const canvas = makeCanvas();
    board.mount(canvas);
    board.loadMoleculeData({
      atoms: [
        { element: "C", x: 0, y: 0 },
        { element: "O", x: 1.0, y: 0 },
      ],
      bonds: [],
    });
    board.setTool("bond");
    const p0 = board.viewport.docToScreen(0, 0);
    // Slightly off the O — still within CONNECT_SNAP
    const pEnd = board.viewport.docToScreen(1.15, 0.12);
    pointer("pointerdown", canvas, p0.x, p0.y);
    pointer("pointerup", canvas, pEnd.x, pEnd.y);
    expect(board.getMoleculeData().atoms).toHaveLength(2);
    expect(board.getMoleculeData().bonds).toHaveLength(1);
    board.unmount();
  });

  it("erase removes atom and incident bonds", async () => {
    const board = new SketchBoard();
    const canvas = makeCanvas();
    board.mount(canvas);
    board.loadMoleculeData({
      atoms: [
        { element: "O", x: 0, y: 0 },
        { element: "H", x: 1, y: 0 },
      ],
      bonds: [{ i: 0, j: 1, order: 1 }],
    });
    board.setTool("erase");
    const p = board.viewport.docToScreen(0, 0);
    pointer("pointerdown", canvas, p.x, p.y);
    expect(board.getMoleculeData().atoms).toHaveLength(1);
    expect(board.getMoleculeData().bonds).toHaveLength(0);
    board.unmount();
  });

  it("select toggle and Delete key", async () => {
    const board = new SketchBoard();
    const canvas = makeCanvas();
    board.mount(canvas);
    board.loadMoleculeData({
      atoms: [{ element: "C", x: 0, y: 0 }],
      bonds: [],
    });
    board.setTool("select");
    const p = board.viewport.docToScreen(0, 0);
    pointer("pointerdown", canvas, p.x, p.y);
    pointer("pointerup", canvas, p.x, p.y);
    canvas.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Delete", bubbles: true }),
    );
    expect(board.getMoleculeData().atoms).toHaveLength(0);
    board.unmount();
  });

  it("selects and drags an atom in one gesture, with undo", async () => {
    const board = new SketchBoard();
    const canvas = makeCanvas();
    board.mount(canvas);
    board.loadMoleculeData({
      atoms: [{ element: "C", x: 0, y: 0 }],
      bonds: [],
    });
    board.setTool("select");
    const start = board.viewport.docToScreen(0, 0);
    const end = board.viewport.docToScreen(1, 0.5);
    pointer("pointerdown", canvas, start.x, start.y);
    pointer("pointermove", canvas, end.x, end.y);
    pointer("pointerup", canvas, end.x, end.y);
    expect(board.getMoleculeData().atoms[0].x).toBeCloseTo(1, 6);
    expect(board.getMoleculeData().atoms[0].y).toBeCloseTo(0.5, 6);
    await board.undo();
    expect(board.getMoleculeData().atoms[0].x).toBeCloseTo(0, 6);
    expect(board.getMoleculeData().atoms[0].y).toBeCloseTo(0, 6);
    board.unmount();
  });

  it("marquee selects enclosed atoms and bonds", async () => {
    const board = new SketchBoard();
    const canvas = makeCanvas();
    board.mount(canvas);
    board.loadMoleculeData({
      atoms: [
        { element: "C", x: -1, y: 0 },
        { element: "C", x: 1, y: 0 },
        { element: "O", x: 3, y: 0 },
      ],
      bonds: [
        { i: 0, j: 1, order: 1 },
        { i: 1, j: 2, order: 1 },
      ],
    });
    board.setTool("select");
    const start = board.viewport.docToScreen(-1.5, -0.5);
    const end = board.viewport.docToScreen(1.5, 0.5);
    pointer("pointerdown", canvas, start.x, start.y);
    pointer("pointermove", canvas, end.x, end.y);
    pointer("pointerup", canvas, end.x, end.y);
    expect(board.getState().selectedAtomCount).toBe(2);
    expect(board.getState().selectedBondCount).toBe(1);
    canvas.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Delete", bubbles: true }),
    );
    expect(board.getMoleculeData().atoms.map((atom) => atom.element)).toEqual([
      "O",
    ]);
    board.unmount();
  });

  it("fuses a ring onto an existing atom or bond", async () => {
    const board = new SketchBoard();
    const canvas = makeCanvas();
    board.mount(canvas);
    board.loadMoleculeData({
      atoms: [{ element: "C", x: 0, y: 0 }],
      bonds: [],
    });
    board.setRingTemplate(6, "aliphatic");
    board.setTool("ring");
    const atom = board.viewport.docToScreen(0, 0);
    pointer("pointerdown", canvas, atom.x, atom.y);
    expect(board.getMoleculeData().atoms).toHaveLength(6);
    expect(board.getMoleculeData().bonds).toHaveLength(6);
    await board.undo();

    board.loadMoleculeData({
      atoms: [
        { element: "C", x: -0.5, y: 0 },
        { element: "C", x: 0.5, y: 0 },
      ],
      bonds: [{ i: 0, j: 1, order: 1 }],
    });
    board.setTool("ring");
    const bond = board.viewport.docToScreen(0, 0);
    pointer("pointerdown", canvas, bond.x, bond.y);
    expect(board.getMoleculeData().atoms).toHaveLength(6);
    expect(board.getMoleculeData().bonds).toHaveLength(6);
    board.unmount();
  });

  it("load creates a new history root and state subscriptions stay current", async () => {
    const board = new SketchBoard();
    const canvas = makeCanvas();
    board.mount(canvas);
    const states: ReturnType<SketchBoard["getState"]>[] = [];
    const unsubscribe = board.subscribe((state) => states.push(state));
    board.setTool("atom");
    const center = board.viewport.docToScreen(0, 0);
    pointer("pointerdown", canvas, center.x, center.y);
    expect(states.at(-1)?.canUndo).toBe(true);
    expect(states.at(-1)?.atomCount).toBe(1);

    board.loadMoleculeData({
      atoms: [{ element: "O", x: 2, y: 0 }],
      bonds: [],
    });
    expect(board.getState().canUndo).toBe(false);
    await board.undo();
    expect(board.getMoleculeData().atoms).toEqual([
      { element: "O", x: 2, y: 0 },
    ]);
    unsubscribe();
    board.unmount();
  });

  it("ignores right-click edits and resolves two-letter element shortcuts", async () => {
    const board = new SketchBoard();
    const canvas = makeCanvas();
    board.mount(canvas);
    board.setTool("atom");
    pointer("pointerdown", canvas, 150, 100, { button: 2 });
    expect(board.getMoleculeData().atoms).toHaveLength(0);

    canvas.dispatchEvent(
      new KeyboardEvent("keydown", { key: "c", bubbles: true }),
    );
    canvas.dispatchEvent(
      new KeyboardEvent("keydown", { key: "l", bubbles: true }),
    );
    expect(board.getElement()).toBe("Cl");
    board.unmount();
  });

  it("colors the full current selection as one undo step", async () => {
    const board = new SketchBoard();
    const canvas = makeCanvas();
    board.mount(canvas);
    board.loadMoleculeData({
      atoms: [
        { element: "N", x: 0, y: 0 },
        { element: "O", x: 1, y: 0 },
      ],
      bonds: [{ i: 0, j: 1, order: 1 }],
    });
    board.setTool("select");
    const start = board.viewport.docToScreen(-0.4, -0.4);
    const end = board.viewport.docToScreen(1.4, 0.4);
    pointer("pointerdown", canvas, start.x, start.y);
    pointer("pointermove", canvas, end.x, end.y);
    pointer("pointerup", canvas, end.x, end.y);
    expect(board.getState()).toMatchObject({
      selectedAtomCount: 2,
      selectedBondCount: 1,
    });
    board.setCustomColor("#008000");
    board.setColorOverrideEnabled(true);
    expect(board.applyColorToSelection()).toBe(true);
    expect(board.getMoleculeData()).toMatchObject({
      atoms: [{ color: "#008000" }, { color: "#008000" }],
      bonds: [{ color: "#008000" }],
    });
    board.setColorOverrideEnabled(false);
    expect(board.applyColorToSelection()).toBe(true);
    expect(board.getMoleculeData().atoms[0].color).toBeUndefined();
    expect(board.getMoleculeData().bonds[0].color).toBeUndefined();
    await board.undo();
    expect(board.getMoleculeData().atoms[0].color).toBe("#008000");
    expect(board.getMoleculeData().bonds[0].color).toBe("#008000");
    await board.undo();
    expect(board.getMoleculeData().atoms[0].color).toBeUndefined();
    expect(board.getMoleculeData().bonds[0].color).toBeUndefined();
    board.unmount();
  });

  it("keeps color override parallel to the active tool", async () => {
    const board = new SketchBoard();
    const canvas = makeCanvas();
    board.mount(canvas);
    board.setCustomColor("#008000");
    board.setColorOverrideEnabled(true);
    board.setTool("chain");
    expect(board.getTool()).toBe("chain");
    const start = board.viewport.docToScreen(-1, 0);
    const end = board.viewport.docToScreen(1, 0);
    pointer("pointerdown", canvas, start.x, start.y);
    pointer("pointermove", canvas, end.x, end.y);
    pointer("pointerup", canvas, end.x, end.y);
    expect(board.getTool()).toBe("chain");
    expect(
      board.getMoleculeData().atoms.every((atom) => atom.color === "#008000"),
    ).toBe(true);
    expect(
      board.getMoleculeData().bonds.every((bond) => bond.color === "#008000"),
    ).toBe(true);

    board.setColorOverrideEnabled(false);
    board.setTool("atom");
    const defaultAtom = board.viewport.docToScreen(3, 0);
    pointer("pointerdown", canvas, defaultAtom.x, defaultAtom.y);
    expect(board.getMoleculeData().atoms.at(-1)?.color).toBeUndefined();
    board.unmount();
  });

  it("disabled state blocks pointer and keyboard mutation", async () => {
    const board = new SketchBoard();
    const canvas = makeCanvas();
    board.mount(canvas);
    board.setTool("atom");
    board.setDisabled(true);
    expect(canvas.tabIndex).toBe(-1);
    pointer("pointerdown", canvas, 150, 100);
    canvas.dispatchEvent(
      new KeyboardEvent("keydown", { key: "o", bubbles: true }),
    );
    expect(board.getMoleculeData().atoms).toHaveLength(0);
    expect(board.getElement()).toBe("C");
    board.setDisabled(false);
    expect(canvas.tabIndex).toBe(0);
    pointer("pointerdown", canvas, 150, 100);
    expect(board.getMoleculeData().atoms).toHaveLength(1);
    board.unmount();
  });

  it("markDirty schedules at most one rAF; idle after paint", async () => {
    const board = new SketchBoard();
    const canvas = makeCanvas();
    const rafCbs: FrameRequestCallback[] = [];
    const original = globalThis.requestAnimationFrame;
    let calls = 0;
    globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
      calls += 1;
      rafCbs.push(cb);
      return calls;
    }) as typeof requestAnimationFrame;
    try {
      board.mount(canvas);
      // flush mount paint
      while (rafCbs.length) {
        const cb = rafCbs.shift();
        cb?.(0);
      }
      calls = 0;
      board.markDirty();
      board.markDirty();
      expect(calls).toBe(1);
      expect(board.isPaintScheduled()).toBe(true);
      rafCbs[0]?.(0);
      expect(board.isPaintScheduled()).toBe(false);
    } finally {
      globalThis.requestAnimationFrame = original;
      board.unmount();
    }
  });

  it("toFrame works without mount", async () => {
    const board = new SketchBoard();
    board.loadMoleculeData({
      atoms: [
        { element: "O", x: 0, y: 0 },
        { element: "H", x: 1, y: 0 },
        { element: "H", x: 0, y: 1 },
      ],
      bonds: [
        { i: 0, j: 1, order: 1 },
        { i: 0, j: 2, order: 1 },
      ],
    });
    const frame = board.toFrame();
    try {
      expect(frame.getBlock("atoms")?.copyColStr("element")).toEqual([
        "O",
        "H",
        "H",
      ]);
    } finally {
      frame.free();
    }
  });
});
