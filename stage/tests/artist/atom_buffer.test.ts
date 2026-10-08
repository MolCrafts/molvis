import { toDomainUint } from "@molcrafts/molvis-core";
import { Block } from "@molcrafts/molvis-core/molrs";
import { describe, expect, it } from "@rstest/core";
import {
  buildAtomBuffers,
  refreshAtomPositions,
} from "../../src/artist/atom_buffer";
import { Tab10Strategy } from "../../src/artist/categorical_theme";
import {
  BALL_AND_STICK,
  type RepresentationStyle,
} from "../../src/artist/representation";
import type { StyleManager } from "../../src/artist/style_manager";
import type { AtomStyle } from "../../src/artist/theme";

function makeTypeOnlyBlock(types: string[]): Block {
  const atoms = new Block();
  atoms.set(
    "x",
    Float64Array.from(types, (_t, i) => i * 1.4),
  );
  atoms.set("y", new Float64Array(types.length));
  atoms.set("z", new Float64Array(types.length));
  atoms.set("type", types);
  return atoms;
}

function makeStyleManager(): StyleManager {
  return {
    getTypeStyle: (_type: string): AtomStyle => ({
      color: "#111111",
      radius: 0.4,
      alpha: 1,
    }),
    getAtomStyle: (_element: string): AtomStyle => ({
      color: "#111111",
      radius: 0.4,
      alpha: 1,
    }),
    getRepresentation: (): RepresentationStyle => BALL_AND_STICK,
    getCategoricalStrategy: () => new Tab10Strategy(),
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
    const buffers = buildAtomBuffers(block, makeStyleManager(), 7).buffers;
    const colors = buffers.get("instanceColor")!;
    expect(buffers.get("instanceStyle")?.[0]).toBe(1);

    expect(readColor(colors, 0)).toEqual(readColor(colors, 2));
    expect(readColor(colors, 0)).not.toEqual(readColor(colors, 1));
  });

  it("uses type_id ordinals when LAMMPS wrote no type label", () => {
    const atoms = new Block();
    atoms.set("x", new Float64Array([0, 1, 2]));
    atoms.set("y", new Float64Array([0.1, 0.1, 0.1]));
    atoms.set("z", new Float64Array([0.1, 0.1, 0.1]));
    atoms.set("type_id", toDomainUint([1, 2, 1]));
    const colors = buildAtomBuffers(atoms, makeStyleManager(), 7).buffers.get(
      "instanceColor",
    )!;
    expect(readColor(colors, 0)).toEqual(readColor(colors, 2));
    expect(readColor(colors, 0)).not.toEqual(readColor(colors, 1));
  });

  it("keeps type colors stable when row order changes", () => {
    const first = buildAtomBuffers(
      makeTypeOnlyBlock(["opls_145", "opls_146"]),
      makeStyleManager(),
      7,
    ).buffers.get("instanceColor")!;
    const second = buildAtomBuffers(
      makeTypeOnlyBlock(["opls_146", "opls_145"]),
      makeStyleManager(),
      7,
    ).buffers.get("instanceColor")!;

    expect(readColor(first, 0)).toEqual(readColor(second, 1));
    expect(readColor(first, 1)).toEqual(readColor(second, 0));
  });

  it("omits a pile of exact-origin sentinels from GPU instances", () => {
    const atoms = new Block();
    atoms.set("x", new Float64Array([1.4, 2.8, 0, 0, 0, 0]));
    atoms.set("y", new Float64Array(6));
    atoms.set("z", new Float64Array(6));
    atoms.set("element", ["C", "C", "C", "C", "C", "C"]);
    const built = buildAtomBuffers(atoms, makeStyleManager(), 7);
    const data = built.buffers.get("instanceData")!;
    expect(data.length / 4).toBe(2);
    expect(built.instanceMap).toEqual(new Uint32Array([0, 1]));
    expect(data[0]).toBeCloseTo(1.4);
    expect(data[4]).toBeCloseTo(2.8);
  });
});

describe("refreshAtomPositions", () => {
  function makeAtomState(count: number) {
    const uploads: string[] = [];
    const matrix = new Float32Array(count * 16).fill(7);
    const instanceData = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) instanceData[i * 4 + 3] = 0.5; // radius
    return {
      uploads,
      matrix,
      instanceData,
      state: {
        getTotalCount: () => count,
        buffers: new Map([
          ["matrix", { data: matrix }],
          ["instanceData", { data: instanceData }],
        ]),
        uploadBuffer(name: string) {
          uploads.push(name);
        },
      },
    };
  }

  it("writes xyz into instanceData, keeps the radius, and uploads only that buffer", () => {
    const { uploads, matrix, instanceData, state } = makeAtomState(2);
    const before = matrix.slice();

    refreshAtomPositions(
      new Float64Array([1, 4]),
      new Float64Array([2, 5]),
      new Float64Array([3, 6]),
      state,
    );

    expect(Array.from(instanceData)).toEqual([1, 2, 3, 0.5, 4, 5, 6, 0.5]);
    expect(Array.from(matrix)).toEqual(Array.from(before));
    expect(uploads).toEqual(["instanceData"]);
  });

  it("clamps to the registered instance count", () => {
    const { instanceData, state } = makeAtomState(1);
    refreshAtomPositions(
      new Float64Array([1, 9]),
      new Float64Array([2, 9]),
      new Float64Array([3, 9]),
      state,
    );
    expect(Array.from(instanceData)).toEqual([1, 2, 3, 0.5]);
  });
});
