import { Block } from "@molcrafts/molrs";
import { describe, expect, it } from "@rstest/core";
import { buildAtomBuffers } from "../src/artist/atom_buffer";
import { BALL_AND_STICK } from "../src/artist/representation";
import type { StyleManager } from "../src/artist/style_manager";

function makeTypeOnlyBlock(types: string[]): Block {
  const atoms = new Block();
  atoms.setColF("x", new Float64Array(types.length));
  atoms.setColF("y", new Float64Array(types.length));
  atoms.setColF("z", new Float64Array(types.length));
  atoms.setColStr("type", types);
  return atoms;
}

function makeStyleManager(): StyleManager {
  return {
    getTypeStyle: () => ({
      color: "#111111",
      radius: 0.4,
      alpha: 1,
    }),
    getAtomStyle: () => ({
      color: "#111111",
      radius: 0.4,
      alpha: 1,
    }),
    getRepresentation: () => BALL_AND_STICK,
  } as StyleManager;
}

function readColor(
  buffer: Float32Array,
  index: number,
): [number, number, number, number] {
  const offset = index * 4;
  return [
    buffer[offset],
    buffer[offset + 1],
    buffer[offset + 2],
    buffer[offset + 3],
  ];
}

describe("buildAtomBuffers", () => {
  it("uses dataset-level categorical colors for type-only frames", () => {
    const block = makeTypeOnlyBlock(["opls_146", "opls_145", "opls_146"]);
    const buffers = buildAtomBuffers(block, makeStyleManager(), 7);
    const colors = buffers.get("instanceColor")!;
    expect(buffers.get("instanceStyle")?.[0]).toBe(1);

    expect(readColor(colors, 0)).toEqual(readColor(colors, 2));
    expect(readColor(colors, 0)).not.toEqual(readColor(colors, 1));
  });

  it("keeps type colors stable when row order changes", () => {
    const first = buildAtomBuffers(
      makeTypeOnlyBlock(["opls_145", "opls_146"]),
      makeStyleManager(),
      7,
    ).get("instanceColor")!;
    const second = buildAtomBuffers(
      makeTypeOnlyBlock(["opls_146", "opls_145"]),
      makeStyleManager(),
      7,
    ).get("instanceColor")!;

    expect(readColor(first, 0)).toEqual(readColor(second, 1));
    expect(readColor(first, 1)).toEqual(readColor(second, 0));
  });
});
