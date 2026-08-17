/**
 * Overlay system unit tests.
 *
 * Tests run without a real BabylonJS scene. We cover:
 *   - OverlayManager CRUD + events (no BabylonJS needed — lazy texture init)
 *   - VectorFieldModifier pipeline integration (pass-through, postRenderEffect)
 *
 * Arrow3D / Arrow2D / TextLabel / VectorField rendering tests require a real
 * BabylonJS engine and are integration tests outside this file.
 */

import { Block, Frame } from "@molcrafts/molvis-core/molrs";
import { describe, expect, test } from "@rstest/core";
import "../setup_wasm";
import type { MolvisApp } from "../../src/app";
import { VectorFieldModifier } from "../../src/modifiers/VectorFieldModifier";
import { OverlayManager } from "../../src/overlays/overlay_manager";
import type { Overlay } from "../../src/overlays/types";
import { createDefaultContext } from "../../src/pipeline/types";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeOverlay(id: string): Overlay & { _disposed: boolean } {
  let _disposed = false;
  const o: Overlay & { _disposed: boolean } = {
    id,
    type: "mock",
    visible: true,
    get _disposed() {
      return _disposed;
    },
    dispose() {
      _disposed = true;
    },
  };
  return o;
}

/** OverlayManager without needing a real BabylonJS scene (no text labels). */
function makeManager(): OverlayManager {
  // Cast to Scene — the manager won't access it unless labelTexture is called.
  return new OverlayManager({} as unknown as import("@babylonjs/core").Scene);
}

// ── OverlayManager ────────────────────────────────────────────────────────────

describe("OverlayManager (CRUD + events)", () => {
  test("add() stores overlay and emits overlay-added", () => {
    const mgr = makeManager();
    const added: Overlay[] = [];
    mgr.on("overlay-added", ({ overlay }) => added.push(overlay));

    const o = makeOverlay("o1");
    const returned = mgr.add(o);

    expect(returned).toBe(o);
    expect(mgr.get("o1")).toBe(o);
    expect(added).toHaveLength(1);
    expect(added[0]).toBe(o);
  });

  test("remove() disposes overlay and emits overlay-removed", () => {
    const mgr = makeManager();
    const removed: string[] = [];
    mgr.on("overlay-removed", ({ id }) => removed.push(id));

    const o = makeOverlay("o2");
    mgr.add(o);
    mgr.remove("o2");

    expect(mgr.get("o2")).toBeUndefined();
    expect(o._disposed).toBe(true);
    expect(removed).toContain("o2");
  });

  test("remove() is a no-op for unknown id", () => {
    const mgr = makeManager();
    expect(() => mgr.remove("nonexistent")).not.toThrow();
  });

  test("list() returns all overlays in insertion order", () => {
    const mgr = makeManager();
    const a = makeOverlay("a");
    const b = makeOverlay("b");
    mgr.add(a);
    mgr.add(b);
    const list = mgr.list();
    expect(list[0]).toBe(a);
    expect(list[1]).toBe(b);
  });

  test("setVisible() updates overlay.visible and emits overlay-changed", () => {
    const mgr = makeManager();
    const changed: Overlay[] = [];
    mgr.on("overlay-changed", ({ overlay }) => changed.push(overlay));

    const o = makeOverlay("o3");
    mgr.add(o);
    mgr.setVisible("o3", false);

    expect(o.visible).toBe(false);
    expect(changed).toHaveLength(1);
    expect(changed[0]).toBe(o);
  });

  test("clear() disposes all overlays and empties the list", () => {
    const mgr = makeManager();
    const a = makeOverlay("a");
    const b = makeOverlay("b");
    mgr.add(a);
    mgr.add(b);
    mgr.clear();

    expect(mgr.list()).toHaveLength(0);
    expect(a._disposed).toBe(true);
    expect(b._disposed).toBe(true);
  });

  test("updateScreenPositions() calls overlay.updateScreenPositions when present", () => {
    const mgr = makeManager();
    let called = false;
    const o: Overlay = {
      id: "screen1",
      type: "mock",
      visible: true,
      dispose() {},
      updateScreenPositions() {
        called = true;
      },
    };
    mgr.add(o);
    mgr.updateScreenPositions();
    expect(called).toBe(true);
  });

  test("updateScreenPositions() skips overlays without the method", () => {
    const mgr = makeManager();
    mgr.add(makeOverlay("no_screen"));
    expect(() => mgr.updateScreenPositions()).not.toThrow();
  });

  test("addMany adds all overlays", () => {
    const mgr = makeManager();
    mgr.addMany([makeOverlay("x1"), makeOverlay("x2"), makeOverlay("x3")]);
    expect(mgr.list()).toHaveLength(3);
  });

  test("removeMany removes the specified overlays", () => {
    const mgr = makeManager();
    mgr.addMany([makeOverlay("x1"), makeOverlay("x2"), makeOverlay("x3")]);
    mgr.removeMany(["x1", "x3"]);
    expect(mgr.list()).toHaveLength(1);
    expect(mgr.get("x2")).toBeDefined();
    expect(mgr.get("x1")).toBeUndefined();
  });

  test("overlay-added fires for each overlay in addMany", () => {
    const mgr = makeManager();
    const ids: string[] = [];
    mgr.on("overlay-added", ({ overlay }) => ids.push(overlay.id));
    mgr.addMany([makeOverlay("p"), makeOverlay("q")]);
    expect(ids).toEqual(["p", "q"]);
  });
});

// ── VectorFieldModifier ───────────────────────────────────────────────────────

describe("VectorFieldModifier", () => {
  function makeFrame(n: number): Frame {
    const frame = new Frame();
    const atoms = new Block();
    const xs = new Float64Array(n);
    const ys = new Float64Array(n);
    const zs = new Float64Array(n);
    const vxs = new Float64Array(n).fill(1);
    const vys = new Float64Array(n);
    const vzs = new Float64Array(n);
    for (let i = 0; i < n; i++) xs[i] = i;
    atoms.setColF("x", xs);
    atoms.setColF("y", ys);
    atoms.setColF("z", zs);
    atoms.setColF("fx", vxs);
    atoms.setColF("fy", vys);
    atoms.setColF("fz", vzs);
    frame.insertBlock("atoms", atoms);
    return frame;
  }

  /** Stub MolvisApp — only overlayManager and events used. */
  function makeMockApp(existingOverlay?: object) {
    const added: unknown[] = [];
    let getCallCount = 0;
    return {
      scene: {},
      overlayManager: {
        get(_id: string) {
          getCallCount++;
          return existingOverlay;
        },
        add(o: unknown) {
          added.push(o);
          return o;
        },
        remove(_id: string) {},
        get _added() {
          return added;
        },
        get _getCallCount() {
          return getCallCount;
        },
      },
      events: {
        _emitted: [] as string[],
        emit(name: string) {
          this._emitted.push(name);
        },
      },
    } as unknown as MolvisApp & {
      overlayManager: { _added: unknown[]; _getCallCount: number };
      events: { _emitted: string[] };
    };
  }

  test("apply() returns the input frame unchanged (pass-through)", () => {
    const mod = new VectorFieldModifier("vf1", {
      vxCol: "fx",
      vyCol: "fy",
      vzCol: "fz",
    });
    const frame = makeFrame(3);
    const app = makeMockApp();
    const ctx = createDefaultContext(frame, app);
    expect(mod.apply(frame, ctx)).toBe(frame);
  });

  test("apply() registers exactly one postRenderEffect", () => {
    const mod = new VectorFieldModifier("vf2", {
      vxCol: "fx",
      vyCol: "fy",
      vzCol: "fz",
    });
    const frame = makeFrame(5);
    const ctx = createDefaultContext(frame, makeMockApp());
    mod.apply(frame, ctx);
    expect(ctx.postRenderEffects).toHaveLength(1);
  });

  test("apply() registers no postRenderEffect when columns are missing", () => {
    const mod = new VectorFieldModifier("vf3", {
      vxCol: "missing_x",
      vyCol: "missing_y",
      vzCol: "missing_z",
    });
    const frame = makeFrame(3);
    const ctx = createDefaultContext(frame, makeMockApp());
    mod.apply(frame, ctx);
    expect(ctx.postRenderEffects).toHaveLength(0);
  });

  test("getCacheKey() differs for different vxCol", () => {
    const m1 = new VectorFieldModifier("v", {
      vxCol: "fx",
      vyCol: "fy",
      vzCol: "fz",
    });
    const m2 = new VectorFieldModifier("v", {
      vxCol: "gx",
      vyCol: "gy",
      vzCol: "gz",
    });
    expect(m1.getCacheKey()).not.toBe(m2.getCacheKey());
  });

  test("getCacheKey() differs for different scale", () => {
    const m1 = new VectorFieldModifier("v", {
      vxCol: "fx",
      vyCol: "fy",
      vzCol: "fz",
      scale: 1,
    });
    const m2 = new VectorFieldModifier("v", {
      vxCol: "fx",
      vyCol: "fy",
      vzCol: "fz",
      scale: 2,
    });
    expect(m1.getCacheKey()).not.toBe(m2.getCacheKey());
  });

  test("cleanup() is a no-op before any overlay is created", () => {
    const mod = new VectorFieldModifier("vf4", {
      vxCol: "fx",
      vyCol: "fy",
      vzCol: "fz",
    });
    let removed = false;
    mod.cleanup({
      overlayManager: {
        remove() {
          removed = true;
        },
      },
    });
    expect(removed).toBe(false);
  });

  test("enabled=false makes apply() skip and register no effect", () => {
    const mod = new VectorFieldModifier("vf5", {
      vxCol: "fx",
      vyCol: "fy",
      vzCol: "fz",
    });
    mod.enabled = false;
    const frame = makeFrame(3);
    const ctx = createDefaultContext(frame, makeMockApp());
    const out = mod.apply(frame, ctx);
    expect(out).toBe(frame);
    expect(ctx.postRenderEffects).toHaveLength(0);
  });
});
