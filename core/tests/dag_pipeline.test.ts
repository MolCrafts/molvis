import { Block, Frame } from "@molcrafts/molrs";
import { describe, expect, it } from "@rstest/core";
import "./setup_wasm";
import type { MolvisApp } from "../src/app";
import { ExpressionSelectionModifier } from "../src/modifiers/ExpressionSelectionModifier";
import { SelectModifier } from "../src/modifiers/SelectModifier";
import { BaseModifier, ModifierCapability } from "../src/pipeline/modifier";
import { ModifierPipeline } from "../src/pipeline/pipeline";
import type { PipelineContext } from "../src/pipeline/types";
import type { SelectionMask } from "../src/pipeline/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFrame(elements: string[]): Frame {
  const frame = new Frame();
  const atoms = new Block();
  atoms.setColF("x", new Float64Array(elements.length));
  atoms.setColF("y", new Float64Array(elements.length));
  atoms.setColF("z", new Float64Array(elements.length));
  atoms.setColStr("element", elements);
  frame.insertBlock("atoms", atoms);
  return frame;
}

const mockApp = {} as MolvisApp;

/**
 * A test modifier that records the currentSelection it receives at apply time.
 * Does not modify the frame.
 */
class SpyModifier extends BaseModifier {
  public receivedSelection: SelectionMask | null = null;

  constructor(id: string) {
    super(id, "Spy", new Set([ModifierCapability.ConsumesSelection]));
  }

  apply(input: Frame, context: PipelineContext): Frame {
    this.receivedSelection = context.currentSelection;
    return input;
  }
}

/**
 * Extract a cached selection from a context, failing the test if absent.
 */
function getCachedSelection(
  ctx: PipelineContext | null,
  modifierId: string,
): SelectionMask {
  if (ctx === null) {
    throw new Error("context was null");
  }
  const mask = ctx.selectionCache.get(modifierId);
  if (mask === undefined) {
    throw new Error(`selectionCache missing key "${modifierId}"`);
  }
  return mask;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("compute() with parentId", () => {
  it("selection-producing modifier populates selectionCache", async () => {
    const pipeline = new ModifierPipeline();

    const sel = new SelectModifier("_", [0, 1]);
    pipeline.addModifier(sel); // id reassigned to NATO
    const selId = sel.id;

    let capturedCtx: PipelineContext | null = null;
    pipeline.on("computed", ({ context }) => {
      capturedCtx = context;
    });

    const frame = makeFrame(["C", "O", "N"]);
    await pipeline.compute(0, mockApp, "full", frame);

    expect(capturedCtx).not.toBeNull();
    expect(capturedCtx?.selectionCache.has(selId)).toBe(true);

    const cached = getCachedSelection(capturedCtx, selId);
    expect(cached.isSelected(0)).toBe(true);
    expect(cached.isSelected(1)).toBe(true);
    expect(cached.isSelected(2)).toBe(false);
  });

  it("child modifier with parentId gets parent selection", async () => {
    const pipeline = new ModifierPipeline();

    const sel = new SelectModifier("_", [0, 1]);
    pipeline.addModifier(sel);

    const spy = new SpyModifier("_");
    spy.parentId = sel.id; // read after addModifier
    pipeline.addModifier(spy);

    const frame = makeFrame(["C", "O", "N"]);
    await pipeline.compute(0, mockApp, "full", frame);

    expect(spy.receivedSelection).not.toBeNull();
    expect(spy.receivedSelection?.isSelected(0)).toBe(true);
    expect(spy.receivedSelection?.isSelected(1)).toBe(true);
    expect(spy.receivedSelection?.isSelected(2)).toBe(false);
  });

  it("child before parent in array gets all atoms (parent not yet cached)", async () => {
    const pipeline = new ModifierPipeline();

    // Child appears BEFORE parent — set parentId to a name we'll give the parent
    const spy = new SpyModifier("_");
    pipeline.addModifier(spy);

    const sel = new SelectModifier("_", [0]);
    pipeline.addModifier(sel);

    // Now set parentId to sel's NATO ID — but spy was added first,
    // so during compute spy runs before sel and sel isn't cached yet
    spy.parentId = sel.id;

    const frame = makeFrame(["C", "O", "N"]);
    await pipeline.compute(0, mockApp, "full", frame);

    expect(spy.receivedSelection).not.toBeNull();
    expect(spy.receivedSelection?.isSelected(0)).toBe(true);
    expect(spy.receivedSelection?.isSelected(1)).toBe(true);
    expect(spy.receivedSelection?.isSelected(2)).toBe(true);
  });

  it("disabled parent means child gets all atoms", async () => {
    const pipeline = new ModifierPipeline();

    const sel = new SelectModifier("_", [0]);
    sel.enabled = false;
    pipeline.addModifier(sel);

    const spy = new SpyModifier("_");
    spy.parentId = sel.id;
    pipeline.addModifier(spy);

    const frame = makeFrame(["C", "O", "N"]);
    await pipeline.compute(0, mockApp, "full", frame);

    expect(spy.receivedSelection).not.toBeNull();
    expect(spy.receivedSelection?.isSelected(0)).toBe(true);
    expect(spy.receivedSelection?.isSelected(1)).toBe(true);
    expect(spy.receivedSelection?.isSelected(2)).toBe(true);
  });

  it("two children of the same parent both get the same selection", async () => {
    const pipeline = new ModifierPipeline();

    const sel = new SelectModifier("_", [2]);
    pipeline.addModifier(sel);

    const spy1 = new SpyModifier("_");
    spy1.parentId = sel.id;
    pipeline.addModifier(spy1);

    const spy2 = new SpyModifier("_");
    spy2.parentId = sel.id;
    pipeline.addModifier(spy2);

    const frame = makeFrame(["C", "O", "N"]);
    await pipeline.compute(0, mockApp, "full", frame);

    for (const spy of [spy1, spy2]) {
      expect(spy.receivedSelection).not.toBeNull();
      expect(spy.receivedSelection?.isSelected(0)).toBe(false);
      expect(spy.receivedSelection?.isSelected(1)).toBe(false);
      expect(spy.receivedSelection?.isSelected(2)).toBe(true);
    }
  });

  it("root-level modifier (parentId=null) gets all atoms", async () => {
    const pipeline = new ModifierPipeline();

    const sel = new SelectModifier("_", [0]);
    pipeline.addModifier(sel);

    const spy = new SpyModifier("_");
    pipeline.addModifier(spy);

    const frame = makeFrame(["C", "O", "N"]);
    await pipeline.compute(0, mockApp, "full", frame);

    expect(spy.receivedSelection).not.toBeNull();
    expect(spy.receivedSelection?.isSelected(0)).toBe(true);
    expect(spy.receivedSelection?.isSelected(1)).toBe(true);
    expect(spy.receivedSelection?.isSelected(2)).toBe(true);
  });

  it("ExpressionSelectionModifier also populates selectionCache", async () => {
    const pipeline = new ModifierPipeline();

    const exprSel = new ExpressionSelectionModifier("_", "element == 'O'");
    pipeline.addModifier(exprSel);
    const exprId = exprSel.id;

    const spy = new SpyModifier("_");
    spy.parentId = exprId;
    pipeline.addModifier(spy);

    let capturedCtx: PipelineContext | null = null;
    pipeline.on("computed", ({ context }) => {
      capturedCtx = context;
    });

    const frame = makeFrame(["C", "O", "N"]);
    await pipeline.compute(0, mockApp, "full", frame);

    expect(capturedCtx).not.toBeNull();
    expect(capturedCtx?.selectionCache.has(exprId)).toBe(true);

    const cached = getCachedSelection(capturedCtx, exprId);
    expect(cached.isSelected(0)).toBe(false);
    expect(cached.isSelected(1)).toBe(true);
    expect(cached.isSelected(2)).toBe(false);

    expect(spy.receivedSelection).not.toBeNull();
    expect(spy.receivedSelection?.isSelected(1)).toBe(true);
  });
});
