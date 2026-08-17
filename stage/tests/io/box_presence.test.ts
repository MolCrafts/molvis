import {
  Box,
  Frame,
  type Frame as FrameType,
} from "@molcrafts/molvis-core/molrs";
import { describe, expect, it } from "@rstest/core";
import {
  hasPresentBox,
  normalizeFrameBox,
  shouldDrawBox,
} from "../../src/io/box_presence";
import { WrapPBCModifier } from "../../src/modifiers/WrapPBCModifier";
import {
  DrawBoxModifier,
  defaultSimulationCellEnabled,
} from "../../src/pipeline/draw_box";
import "../setup_wasm";

/** Fake box: molrs rejects singular H, so unit-test the length gate with a stub. */
function stubBox(lengths: [number, number, number]): Box {
  return {
    lengths() {
      const data = new Float64Array(lengths);
      return {
        toCopy: () => data,
        free: () => {},
      };
    },
  } as unknown as Box;
}

describe("shouldDrawBox / normalizeFrameBox", () => {
  it("present vs draw: 1×1×1 is present but not drawn / not usable for PBC", () => {
    expect(hasPresentBox(undefined)).toBe(false);
    expect(hasPresentBox(stubBox([0, 0, 0]))).toBe(false);
    // Cryo-EM placeholder — keep modifier, hide mesh, no MI.
    expect(hasPresentBox(stubBox([1, 1, 1]))).toBe(true);
    expect(shouldDrawBox(stubBox([1, 1, 1]))).toBe(false);
    expect(shouldDrawBox(stubBox([1.0, 50, 50]))).toBe(false);
  });

  it("accepts a real orthorhombic cell (edges > 1 Å)", () => {
    const box = Box.cube(10, new Float64Array([0, 0, 0]), true, true, true);
    expect(hasPresentBox(box)).toBe(true);
    expect(shouldDrawBox(box)).toBe(true);
    expect(shouldDrawBox(stubBox([1.01, 1.01, 1.01]))).toBe(true);
    box.free();
  });

  it("normalizeFrameBox clears only zero-size cells, keeps 1×1×1", () => {
    const zero = { box: stubBox([0, 0, 0]) as Box | undefined };
    normalizeFrameBox(zero as FrameType);
    expect(zero.box).toBeUndefined();

    const placeholder = { box: stubBox([1, 1, 1]) as Box | undefined };
    normalizeFrameBox(placeholder as FrameType);
    expect(placeholder.box).toBeDefined();
  });

  it("Simulation cell matches 1×1×1 but defaults enabled=false", () => {
    expect(
      new DrawBoxModifier().matches({ box: stubBox([0, 10, 10]) } as FrameType),
    ).toBe(false);
    const placeholder = { box: stubBox([1, 1, 1]) } as FrameType;
    expect(new DrawBoxModifier().matches(placeholder)).toBe(true);
    expect(defaultSimulationCellEnabled(placeholder)).toBe(false);
    expect(defaultSimulationCellEnabled({ box: stubBox([10, 10, 10]) })).toBe(
      true,
    );
  });

  it("Wrap PBC never auto-attaches even with a usable box", () => {
    const frame = new Frame();
    frame.box = Box.cube(10, new Float64Array([0, 0, 0]), true, true, true);
    const wrap = new WrapPBCModifier("wrap-test");
    expect(wrap.matches(frame)).toBe(false);
    expect(wrap.isApplicable(frame)).toBe(true);
    frame.free();
  });
});
