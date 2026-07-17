import { Block, Box, WasmArray } from "@molcrafts/molrs";
import { describe, expect, it } from "@rstest/core";
import "./setup_wasm";
import {
  buildBondBuffers,
  countBondInstances,
} from "../src/artist/bond_buffer";

function makeBlocks(
  atomCount: number,
  bonds: { i: number; j: number; order: number }[],
): { atoms: Block; bonds: Block } {
  const atoms = new Block();
  atoms.setColF(
    "x",
    new Float64Array(atomCount).fill(0).map((_, i) => i),
  );
  atoms.setColF("y", new Float64Array(atomCount).fill(0));
  atoms.setColF("z", new Float64Array(atomCount).fill(0));
  atoms.setColStr("element", Array(atomCount).fill("C"));

  const bondsBlock = new Block();
  bondsBlock.setColU32("atomi", new Uint32Array(bonds.map((b) => b.i)));
  bondsBlock.setColU32("atomj", new Uint32Array(bonds.map((b) => b.j)));
  bondsBlock.setColU32("order", new Uint32Array(bonds.map((b) => b.order)));

  return { atoms, bonds: bondsBlock };
}

function makeAtomColor(count: number): Float32Array {
  const color = new Float64Array(count * 4);
  for (let i = 0; i < count; i++) {
    color[i * 4 + 0] = 0.5;
    color[i * 4 + 1] = 0.5;
    color[i * 4 + 2] = 0.5;
    color[i * 4 + 3] = 1.0;
  }
  return color;
}

describe("countBondInstances", () => {
  it("should return nrows for all single bonds", () => {
    const { bonds } = makeBlocks(3, [
      { i: 0, j: 1, order: 1 },
      { i: 1, j: 2, order: 1 },
    ]);
    expect(countBondInstances(bonds)).toBe(2);
  });

  it("should return 2 instances for a double bond", () => {
    const { bonds } = makeBlocks(2, [{ i: 0, j: 1, order: 2 }]);
    expect(countBondInstances(bonds)).toBe(2);
  });

  it("should return 3 instances for a triple bond", () => {
    const { bonds } = makeBlocks(2, [{ i: 0, j: 1, order: 3 }]);
    expect(countBondInstances(bonds)).toBe(3);
  });

  it("should sum mixed orders", () => {
    const { bonds } = makeBlocks(4, [
      { i: 0, j: 1, order: 1 },
      { i: 1, j: 2, order: 2 },
      { i: 2, j: 3, order: 3 },
    ]);
    // 1 + 2 + 3 = 6
    expect(countBondInstances(bonds)).toBe(6);
  });

  it("should clamp order to max 3", () => {
    const { bonds } = makeBlocks(2, [{ i: 0, j: 1, order: 5 }]);
    expect(countBondInstances(bonds)).toBe(3);
  });

  it("collapses bond orders for tube and graph representations", () => {
    const { bonds } = makeBlocks(3, [
      { i: 0, j: 1, order: 2 },
      { i: 1, j: 2, order: 3 },
    ]);
    expect(countBondInstances(bonds, "single")).toBe(2);
  });
});

describe("buildBondBuffers with bond order", () => {
  it("should produce 1 instance for single bond", () => {
    const { atoms, bonds } = makeBlocks(2, [{ i: 0, j: 1, order: 1 }]);
    const atomColor = makeAtomColor(2);
    const result = buildBondBuffers(bonds, atoms, atomColor, 42);
    expect(result).not.toBeUndefined();
    expect(result?.instanceCount).toBe(1);
    expect(result?.instanceMap[0]).toBe(0);
  });

  it("should produce 2 instances for double bond", () => {
    const { atoms, bonds } = makeBlocks(2, [{ i: 0, j: 1, order: 2 }]);
    const atomColor = makeAtomColor(2);
    const result = buildBondBuffers(bonds, atoms, atomColor, 42);
    expect(result?.instanceCount).toBe(2);
    // Both instances map to logical bond 0
    expect(result?.instanceMap[0]).toBe(0);
    expect(result?.instanceMap[1]).toBe(0);
  });

  it("should produce 3 instances for triple bond", () => {
    const { atoms, bonds } = makeBlocks(2, [{ i: 0, j: 1, order: 3 }]);
    const atomColor = makeAtomColor(2);
    const result = buildBondBuffers(bonds, atoms, atomColor, 42);
    expect(result?.instanceCount).toBe(3);
    expect(result?.instanceMap[0]).toBe(0);
    expect(result?.instanceMap[1]).toBe(0);
    expect(result?.instanceMap[2]).toBe(0);
  });

  it("emits one tube for a triple bond in single-order mode", () => {
    const { atoms, bonds } = makeBlocks(2, [{ i: 0, j: 1, order: 3 }]);
    const result = buildBondBuffers(bonds, atoms, makeAtomColor(2), 42, {
      orderMode: "single",
    });
    expect(result?.instanceCount).toBe(1);
  });

  it("should produce correct buffer sizes for mixed orders", () => {
    const { atoms, bonds } = makeBlocks(4, [
      { i: 0, j: 1, order: 1 },
      { i: 1, j: 2, order: 2 },
      { i: 2, j: 3, order: 3 },
    ]);
    const atomColor = makeAtomColor(4);
    const result = buildBondBuffers(bonds, atoms, atomColor, 42);
    expect(result?.instanceCount).toBe(6);
    expect(result?.buffers.get("matrix")?.length).toBe(6 * 16);
    expect(result?.buffers.get("instanceData0")?.length).toBe(6 * 4);
  });

  it("should map instances to correct logical bonds", () => {
    const { atoms, bonds } = makeBlocks(4, [
      { i: 0, j: 1, order: 1 }, // instance 0 → bond 0
      { i: 1, j: 2, order: 2 }, // instances 1,2 → bond 1
      { i: 2, j: 3, order: 1 }, // instance 3 → bond 2
    ]);
    const atomColor = makeAtomColor(4);
    const result = buildBondBuffers(bonds, atoms, atomColor, 42);
    expect(result?.instanceCount).toBe(4);
    expect(result?.instanceMap[0]).toBe(0);
    expect(result?.instanceMap[1]).toBe(1);
    expect(result?.instanceMap[2]).toBe(1);
    expect(result?.instanceMap[3]).toBe(2);
  });

  it("double bond sub-instances should have smaller radius", () => {
    const { atoms, bonds } = makeBlocks(2, [{ i: 0, j: 1, order: 2 }]);
    const atomColor = makeAtomColor(2);
    const result = buildBondBuffers(bonds, atoms, atomColor, 42, {
      radius: 0.1,
    });
    const data0 = result?.buffers.get("instanceData0")!;
    // Sub-bond radius should be 0.1 * 0.7 = 0.07
    expect(data0[3]).toBeCloseTo(0.07, 3);
    expect(data0[7]).toBeCloseTo(0.07, 3);
  });

  it("double bond sub-instances should be offset from center", () => {
    const { atoms, bonds } = makeBlocks(2, [{ i: 0, j: 1, order: 2 }]);
    // Place atoms far apart along X to get a clear bond direction
    const atomBlock = atoms;
    atomBlock.setColF("x", new Float64Array([0, 10]));
    const atomColor = makeAtomColor(2);
    const result = buildBondBuffers(bonds, atomBlock, atomColor, 42);
    const data0 = result?.buffers.get("instanceData0")!;
    // Two sub-instances should have same x (midpoint) but different y or z (offset)
    const cx0 = data0[0];
    const cy0 = data0[1];
    const cz0 = data0[2];
    const cx1 = data0[4];
    const cy1 = data0[5];
    const cz1 = data0[6];

    // X should be same (midpoint = 5)
    expect(cx0).toBeCloseTo(cx1, 3);
    // At least one of y/z should differ (offset)
    const offsetDist = Math.sqrt((cy0 - cy1) ** 2 + (cz0 - cz1) ** 2);
    expect(offsetDist).toBeGreaterThan(0.01);
  });

  it("should share picking color for sub-instances of same bond", () => {
    const { atoms, bonds } = makeBlocks(2, [{ i: 0, j: 1, order: 2 }]);
    const atomColor = makeAtomColor(2);
    const result = buildBondBuffers(bonds, atoms, atomColor, 42);
    const pick = result?.buffers.get("instancePickingColor")!;
    // Both sub-instances should have identical picking color
    expect(pick[0]).toBe(pick[4]);
    expect(pick[1]).toBe(pick[5]);
    expect(pick[2]).toBe(pick[6]);
    expect(pick[3]).toBe(pick[7]);
  });

  it("should handle bonds without order column (default to 1)", () => {
    const atoms = new Block();
    atoms.setColF("x", new Float64Array([0, 1]));
    atoms.setColF("y", new Float64Array([0, 0]));
    atoms.setColF("z", new Float64Array([0, 0]));
    const bondsBlock = new Block();
    bondsBlock.setColU32("atomi", new Uint32Array([0]));
    bondsBlock.setColU32("atomj", new Uint32Array([1]));
    // No order column
    const atomColor = makeAtomColor(2);
    const result = buildBondBuffers(bondsBlock, atoms, atomColor, 42);
    expect(result?.instanceCount).toBe(1);
  });
});

/**
 * Compute minimum-image displacements for a bonds block using a real
 * WASM Box. Mirrors the artist-side helper so tests exercise the same
 * path end-to-end (triclinic + partial-PBC are handled by WASM, not by
 * the test).
 */
function miDisplacementsViaBox(
  box: Box,
  atoms: Block,
  bonds: Block,
): Float64Array {
  const n = bonds.nrows();
  const iAtoms = bonds.viewColU32("atomi")!;
  const jAtoms = bonds.viewColU32("atomj")!;
  const x = atoms.viewColF("x")!;
  const y = atoms.viewColF("y")!;
  const z = atoms.viewColF("z")!;
  const a = new Float64Array(n * 3);
  const b = new Float64Array(n * 3);
  for (let k = 0; k < n; k++) {
    const i = iAtoms[k];
    const j = jAtoms[k];
    a[3 * k] = x[i];
    a[3 * k + 1] = y[i];
    a[3 * k + 2] = z[i];
    b[3 * k] = x[j];
    b[3 * k + 1] = y[j];
    b[3 * k + 2] = z[j];
  }
  const shape = new Uint32Array([n, 3]);
  const aArr = WasmArray.from(a, shape);
  const bArr = WasmArray.from(b, shape);
  try {
    const d = box.delta(aArr, bArr, true);
    try {
      return d.toCopy();
    } finally {
      d.free();
    }
  } finally {
    aArr.free();
    bArr.free();
  }
}

describe("buildBondBuffers with PBC minimum image", () => {
  it("collapses a cubic-PBC bond crossing the +x face", () => {
    const atoms = new Block();
    atoms.setColF("x", new Float64Array([9.5, 0.5]));
    atoms.setColF("y", new Float64Array([0, 0]));
    atoms.setColF("z", new Float64Array([0, 0]));
    const bondsBlock = new Block();
    bondsBlock.setColU32("atomi", new Uint32Array([0]));
    bondsBlock.setColU32("atomj", new Uint32Array([1]));
    bondsBlock.setColU32("order", new Uint32Array([1]));
    const atomColor = makeAtomColor(2);
    const box = Box.cube(10, new Float64Array([0, 0, 0]), true, true, true);

    const noPbc = buildBondBuffers(bondsBlock, atoms, atomColor, 42);
    expect(noPbc?.buffers.get("instanceData1")![3]).toBeCloseTo(9, 3);

    const withPbc = buildBondBuffers(bondsBlock, atoms, atomColor, 42, {
      miDisplacements: miDisplacementsViaBox(box, atoms, bondsBlock),
    });
    const d0 = withPbc?.buffers.get("instanceData0")!;
    const d1 = withPbc?.buffers.get("instanceData1")!;
    expect(d1[3]).toBeCloseTo(1, 3);
    expect(d0[0]).toBeCloseTo(10, 3);
    expect(d0[1]).toBeCloseTo(0, 3);
    expect(d0[2]).toBeCloseTo(0, 3);
    box.free();
  });

  it("leaves an in-cell bond untouched", () => {
    const atoms = new Block();
    atoms.setColF("x", new Float64Array([4, 6]));
    atoms.setColF("y", new Float64Array([0, 0]));
    atoms.setColF("z", new Float64Array([0, 0]));
    const bondsBlock = new Block();
    bondsBlock.setColU32("atomi", new Uint32Array([0]));
    bondsBlock.setColU32("atomj", new Uint32Array([1]));
    bondsBlock.setColU32("order", new Uint32Array([1]));
    const atomColor = makeAtomColor(2);
    const box = Box.cube(10, new Float64Array([0, 0, 0]), true, true, true);

    const result = buildBondBuffers(bondsBlock, atoms, atomColor, 42, {
      miDisplacements: miDisplacementsViaBox(box, atoms, bondsBlock),
    });
    expect(result?.buffers.get("instanceData1")![3]).toBeCloseTo(2, 3);
    expect(result?.buffers.get("instanceData0")![0]).toBeCloseTo(5, 3);
    box.free();
  });

  it("honors per-axis PBC flags for a slab (z non-periodic)", () => {
    // Atoms straddle the +x face AND sit far apart in z. With pbc_z = false,
    // the z separation must be preserved (not folded back), and the x
    // separation must collapse to the minimum image.
    const atoms = new Block();
    atoms.setColF("x", new Float64Array([9.5, 0.5]));
    atoms.setColF("y", new Float64Array([0, 0]));
    atoms.setColF("z", new Float64Array([0, 9]));
    const bondsBlock = new Block();
    bondsBlock.setColU32("atomi", new Uint32Array([0]));
    bondsBlock.setColU32("atomj", new Uint32Array([1]));
    bondsBlock.setColU32("order", new Uint32Array([1]));
    const atomColor = makeAtomColor(2);
    const box = Box.ortho(
      new Float64Array([10, 10, 10]),
      new Float64Array([0, 0, 0]),
      true,
      true,
      false,
    );

    const disp = miDisplacementsViaBox(box, atoms, bondsBlock);
    // dx = 0.5 - 9.5 = -9 → minimum image = +1 (via +x wrap).
    // dz = 9 - 0 = +9 → must stay +9 (pbc_z disabled).
    expect(disp[0]).toBeCloseTo(1, 3);
    expect(disp[2]).toBeCloseTo(9, 3);

    const result = buildBondBuffers(bondsBlock, atoms, atomColor, 42, {
      miDisplacements: disp,
    });
    const d1 = result?.buffers.get("instanceData1")!;
    // Bond length = sqrt(1^2 + 0 + 9^2) ≈ 9.055 — z span preserved.
    expect(d1[3]).toBeCloseTo(Math.hypot(1, 0, 9), 3);
    box.free();
  });

  it("handles a triclinic cell where orthorhombic wrap would lie", () => {
    // Triclinic cell with cell vectors stored column-wise, row-major:
    //   a = (10, 5, 0), b = (0, sqrt(75), 0), c = (0, 0, 10)
    //   → cart = H · frac, with H[i][j] = h[3i + j].
    // Atoms placed at fixed Cartesian positions so the raw bond
    // stretches across the cell:
    //   atom 0 = (3.75, 2.165, 0), atom 1 = (11.25, 6.495, 0)
    //   raw displacement = (7.5, 4.330, 0), |d| ≈ 8.66.
    //
    // Under minimum image the WASM path finds the true nearest image
    //   delta ≈ (-2.5, -0.670, 0), |d| ≈ 2.588.
    // A JS fallback that only uses `box.lengths()` would instead wrap
    // independently on each Cartesian axis using (10, 10, 10) and get
    //   delta = (-2.5, 4.330, 0), |d| = 5.0 — still ~2× too long.
    // This test guards the fix against regressing to that fallback.
    const h = new Float64Array([
      10,
      0,
      0, // h row 0 (cart_x coefficients: a_x=10, b_x=0, c_x=0)
      5,
      Math.sqrt(75),
      0, // h row 1 (cart_y coefficients)
      0,
      0,
      10, // h row 2
    ]);
    const box = new Box(h, new Float64Array([0, 0, 0]), true, true, true);
    const atoms = new Block();
    atoms.setColF("x", new Float64Array([3.75, 11.25]));
    atoms.setColF("y", new Float64Array([2.165, 6.495]));
    atoms.setColF("z", new Float64Array([0, 0]));
    const bondsBlock = new Block();
    bondsBlock.setColU32("atomi", new Uint32Array([0]));
    bondsBlock.setColU32("atomj", new Uint32Array([1]));
    bondsBlock.setColU32("order", new Uint32Array([1]));
    const atomColor = makeAtomColor(2);

    const disp = miDisplacementsViaBox(box, atoms, bondsBlock);
    expect(disp[0]).toBeCloseTo(-2.5, 2);
    expect(disp[1]).toBeCloseTo(-0.67, 2);
    expect(disp[2]).toBeCloseTo(0, 3);
    const dispLen = Math.hypot(disp[0], disp[1], disp[2]);
    expect(dispLen).toBeCloseTo(2.588, 2);
    // Guard against regressing to a lengths()-based fallback (which
    // would produce ~5.0) or to no fix at all (~8.66).
    expect(dispLen).toBeLessThan(4);

    const result = buildBondBuffers(bondsBlock, atoms, atomColor, 42, {
      miDisplacements: disp,
    });
    expect(result?.buffers.get("instanceData1")![3]).toBeCloseTo(2.588, 2);
    box.free();
  });
});
