import { Block, Frame } from "@molcrafts/molvis-core/molrs";
import { describe, expect, test } from "@rstest/core";
import "../setup_wasm";
import { toDomainUint } from "@molcrafts/molvis-core";
import type { MolvisApp } from "../../src/app";
import { SelectMaskModifier } from "../../src/modifiers/SelectMaskModifier";
import { createDefaultContext } from "../../src/pipeline/types";
import { MaskFileSyntaxError } from "../../src/selection/mask_file";

function threeAtomFrame(): Frame {
  const frame = new Frame();
  const atoms = new Block();
  atoms.set("id", toDomainUint([10, 20, 30]));
  atoms.set("x", new Float64Array([0, 1, 2]));
  atoms.set("y", new Float64Array([0, 0, 0]));
  atoms.set("z", new Float64Array([0, 0, 0]));
  atoms.set("element", ["H", "C", "H"]);
  frame.set("atoms", atoms);
  return frame;
}

describe("SelectMaskModifier", () => {
  const mockApp = {} as MolvisApp;

  test("apply resolves atom ids to rows and writes selection", () => {
    const frame = threeAtomFrame();
    const context = createDefaultContext(frame, mockApp);
    const mod = new SelectMaskModifier("mask");
    mod.setMaskText("10 30");
    mod.apply(frame, context);

    expect(context.currentSelection.count()).toBe(2);
    expect(context.currentSelection.isSelected(0)).toBe(true);
    expect(context.currentSelection.isSelected(1)).toBe(false);
    expect(context.currentSelection.isSelected(2)).toBe(true);
    expect(context.selectionSet.get("mask")?.getIndices()).toEqual([0, 2]);
  });

  test("empty mask selects nothing, never all", () => {
    const frame = threeAtomFrame();
    const context = createDefaultContext(frame, mockApp);
    const mod = new SelectMaskModifier("mask");
    mod.setMaskText("");
    mod.apply(frame, context);

    expect(context.currentSelection.isEmpty()).toBe(true);
    expect(context.currentSelection.isAll()).toBe(false);
  });

  test("setMaskText sorts and dedupes ids", () => {
    const mod = new SelectMaskModifier("mask");
    mod.setMaskText("30 10 30 20");
    expect(mod.ids).toEqual([10, 20, 30]);
  });

  test("unknown ids fail validation", () => {
    const frame = threeAtomFrame();
    const context = createDefaultContext(frame, mockApp);
    const mod = new SelectMaskModifier("mask");
    mod.setMaskText("10 40");
    const result = mod.validate(frame, context);
    expect(result.valid).toBe(false);
    expect(result.errors?.join(" ")).toContain("not present");
    expect(result.errors?.join(" ")).toContain("40");
  });

  test("frame without an id column fails validation for a non-empty mask", () => {
    const frame = new Frame();
    const atoms = new Block();
    atoms.set("x", new Float64Array([0, 1, 2]));
    frame.set("atoms", atoms);

    const context = createDefaultContext(frame, mockApp);
    const mod = new SelectMaskModifier("mask");
    mod.setMaskText("10");
    const result = mod.validate(frame, context);
    expect(result.valid).toBe(false);
    expect(result.errors?.join(" ")).toContain("no `id` column");
  });

  test("@atoms mismatch is a warning, not an error", () => {
    const frame = threeAtomFrame();
    const context = createDefaultContext(frame, mockApp);
    const mod = new SelectMaskModifier("mask");
    mod.setMaskText("@atoms 5\n10");
    const result = mod.validate(frame, context);
    expect(result.valid).toBe(true);
    expect(result.warnings?.join(" ")).toContain("@atoms 5");
  });

  test("setMaskText throws on malformed content", () => {
    const mod = new SelectMaskModifier("mask");
    expect(() => mod.setMaskText("10\n-1")).toThrow(MaskFileSyntaxError);
  });

  test("cache key is stable for the same set and changes for a different set", () => {
    const mod = new SelectMaskModifier("mask");
    mod.setMaskText("30 10");
    const first = mod.getCacheKey();
    mod.setMaskText("10 30");
    expect(mod.getCacheKey()).toBe(first);
    mod.setMaskText("10 20");
    expect(mod.getCacheKey()).not.toBe(first);
  });

  test("fromProjectParams hydrates sorted, deduped ids", () => {
    const mod = new SelectMaskModifier("mask");
    mod.fromProjectParams({
      ids: [30, 10, 30],
      expectedCount: 3,
      sourceLabel: "surface.mask",
    });
    expect(mod.ids).toEqual([10, 30]);
    expect(mod.expectedCount).toBe(3);
    expect(mod.sourceLabel).toBe("surface.mask");

    const frame = threeAtomFrame();
    const context = createDefaultContext(frame, mockApp);
    mod.apply(frame, context);
    expect(context.currentSelection.getIndices()).toEqual([0, 2]);
  });

  test("selects nothing when no atoms block exists", () => {
    const frame = new Frame();
    const context = createDefaultContext(frame, mockApp);
    const mod = new SelectMaskModifier("mask");
    mod.setMaskText("10");
    mod.apply(frame, context);
    expect(context.currentSelection.size).toBe(0);
    expect(context.currentSelection.isEmpty()).toBe(true);
  });
});
