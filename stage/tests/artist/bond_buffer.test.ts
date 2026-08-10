import { Vector3 } from "@babylonjs/core";
import { Block, Box, WasmArray } from "@molcrafts/molvis-core/molrs";
import { describe, expect, it } from "@rstest/core";
import "../setup_wasm";
import {
  type BondBufferResult,
  buildBondBuffers,
  countBondInstances,
  refreshBondPositions,
} from "../../src/artist/bond_buffer";
import { displayBondOrder } from "../../src/utils/bond_order";

function getBuffer(
  result: BondBufferResult | undefined,
  name: string,
): Float32Array {
  if (!result) {
    throw new Error("Expected bond buffers to be built");
  }
  const buffer = result.buffers.get(name);
  if (!buffer) {
    throw new Error(`Expected bond buffer "${name}"`);
  }
  return buffer;
}

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
  // molrs bond_type / bond_number. order 1.5 in fixtures → aromatic (type 4).
  const types = new Uint32Array(
    bonds.map((b) =>
      b.order === 1.5 ? 4 : Math.max(1, Math.min(3, Math.round(b.order))),
    ),
  );
  const numbers = new Uint32Array(
    bonds.map((b) =>
      b.order === 1.5 ? 0 : Math.max(1, Math.min(3, Math.round(b.order))),
    ),
  );
  bondsBlock.setColU32("bond_type", types);
  bondsBlock.setColU32("bond_number", numbers);

  return { atoms, bonds: bondsBlock };
}

/**
 * Kekulé benzene, C–C = 1.397 Å, in a plane deliberately aligned with no
 * coordinate axis: a ring in z = 0 would pass even with an axis-derived
 * perpendicular, since `dir × ẑ` happens to land back in that plane.
 * Returns the ring normal so tests can assert coplanarity directly.
 */
function makeBenzene(): { atoms: Block; bonds: Block; normal: Vector3 } {
  const { atoms, bonds } = makeBlocks(6, [
    { i: 0, j: 1, order: 2 },
    { i: 1, j: 2, order: 1 },
    { i: 2, j: 3, order: 2 },
    { i: 3, j: 4, order: 1 },
    { i: 4, j: 5, order: 2 },
    { i: 5, j: 0, order: 1 },
  ]);

  const normal = new Vector3(1, 2, 3).normalize();
  const u = Vector3.Cross(normal, new Vector3(0, 0, 1)).normalize();
  const v = Vector3.Cross(normal, u);

  const radius = 1.397;
  const x = new Float64Array(6);
  const y = new Float64Array(6);
  const z = new Float64Array(6);
  for (let k = 0; k < 6; k++) {
    const angle = (k * Math.PI) / 3;
    const c = radius * Math.cos(angle);
    const s = radius * Math.sin(angle);
    x[k] = u.x * c + v.x * s;
    y[k] = u.y * c + v.y * s;
    z[k] = u.z * c + v.z * s;
  }
  atoms.setColF("x", x);
  atoms.setColF("y", y);
  atoms.setColF("z", z);
  return { atoms, bonds, normal };
}

function makeAtomColor(count: number): Float32Array {
  const color = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    color[i * 4 + 0] = 0.5;
    color[i * 4 + 1] = 0.5;
    color[i * 4 + 2] = 0.5;
    color[i * 4 + 3] = 1.0;
  }
  return color;
}

describe("displayBondOrder (molrs bond_type / bond_number)", () => {
  it("maps aromatic bond_type=4, bond_number=0 to one stick", () => {
    expect(displayBondOrder(4, 0)).toBe(1);
  });

  it("keeps Lewis single / double / triple", () => {
    expect(displayBondOrder(1, 1)).toBe(1);
    expect(displayBondOrder(2, 2)).toBe(2);
    expect(displayBondOrder(3, 3)).toBe(3);
  });
});

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

  it("aromatic bond_type=4 with bond_number=0 is one stick (no local Kekulé)", () => {
    // Stick mapping is pure: number=0 → 1 stick. Ingress fills number via molrs.
    const { bonds } = makeBlocks(2, [{ i: 0, j: 1, order: 1.5 }]);
    expect(countBondInstances(bonds)).toBe(1);
  });

  it("aromatic bond with Kekulé bond_number drives multi-stick", () => {
    // Simulate molrs findKekuleOrders output: type=4, number=2 → two sticks.
    const atoms = new Block();
    atoms.setColF("x", new Float64Array([0, 1]));
    atoms.setColF("y", new Float64Array([0, 0]));
    atoms.setColF("z", new Float64Array([0, 0]));
    atoms.setColStr("element", ["C", "C"]);
    const bonds = new Block();
    bonds.setColU32("atomi", new Uint32Array([0]));
    bonds.setColU32("atomj", new Uint32Array([1]));
    bonds.setColU32("bond_type", new Uint32Array([4]));
    bonds.setColU32("bond_number", new Uint32Array([2]));
    expect(countBondInstances(bonds)).toBe(2);
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

  it("keeps double-bond strokes as thick as a single bond", () => {
    const { atoms, bonds } = makeBlocks(2, [{ i: 0, j: 1, order: 2 }]);
    const atomColor = makeAtomColor(2);
    const result = buildBondBuffers(bonds, atoms, atomColor, 42, {
      radius: 0.1,
    });
    const data0 = getBuffer(result, "instanceData0");
    expect(data0[3]).toBeCloseTo(0.1, 3);
    expect(data0[7]).toBeCloseTo(0.1, 3);
  });

  it("keeps triple-bond strokes compact and centered", () => {
    const { atoms, bonds } = makeBlocks(2, [{ i: 0, j: 1, order: 3 }]);
    atoms.setColF("x", new Float64Array([0, 10]));
    const result = buildBondBuffers(bonds, atoms, makeAtomColor(2), 42, {
      radius: 0.1,
    });
    const data0 = getBuffer(result, "instanceData0");

    expect(data0[3]).toBeCloseTo(0.1, 3);
    expect(data0[7]).toBeCloseTo(0.1, 3);
    expect(data0[11]).toBeCloseTo(0.1, 3);
    // Center stroke remains on-axis; side strokes have enough clearance not to
    // merge visually with the full-radius center stroke.
    expect(data0[1]).toBeCloseTo(0, 3);
    expect(data0[2]).toBeCloseTo(0, 3);
    expect(data0[5]).toBeCloseTo(-data0[9], 3);
    expect(data0[6]).toBeCloseTo(-data0[10], 3);
    const sideOffset = Math.hypot(data0[5], data0[6]);
    expect(sideOffset).toBeCloseTo(0.18, 3);
  });

  it("spaces an isolated diatomic along a fixed axis", () => {
    // O=O spans no molecular plane and is cylindrically symmetric, so a fixed
    // reference axis decides — the answer stays a function of the molecule.
    const { atoms, bonds } = makeBlocks(2, [{ i: 0, j: 1, order: 2 }]);
    atoms.setColF("x", new Float64Array([0, 10]));
    const result = buildBondBuffers(bonds, atoms, makeAtomColor(2), 42);
    const data0 = getBuffer(result, "instanceData0");

    // X-axis bond crosses ẑ, so the strokes spread along ∓y.
    expect(data0[2]).toBeCloseTo(0, 3);
    expect(data0[6]).toBeCloseTo(0, 3);
    expect(data0[1]).toBeCloseTo(-data0[5], 3);
    expect(Math.abs(data0[1])).toBeCloseTo(0.09, 3);
  });

  it("keeps benzene double bonds flat in the ring plane", () => {
    const { atoms, bonds, normal } = makeBenzene();
    const result = buildBondBuffers(bonds, atoms, makeAtomColor(6), 42);
    const data0 = getBuffer(result, "instanceData0");

    expect(result?.instanceCount).toBe(9); // 3 doubles + 3 singles
    // The ring is centered on the origin, so every stroke centre must sit on
    // the ring plane itself: zero projection onto its normal.
    for (let s = 0; s < 9; s++) {
      const centre = new Vector3(
        data0[s * 4 + 0],
        data0[s * 4 + 1],
        data0[s * 4 + 2],
      );
      expect(Vector3.Dot(centre, normal)).toBeCloseTo(0, 5);
    }
  });

  it("splits benzene double-bond strokes symmetrically about the bond axis", () => {
    const { atoms, bonds, normal } = makeBenzene();
    const result = buildBondBuffers(bonds, atoms, makeAtomColor(6), 42);
    const data0 = getBuffer(result, "instanceData0");
    const data1 = getBuffer(result, "instanceData1");

    // Bond 0 (C0=C1) expands to render instances 0 and 1.
    const separation = new Vector3(
      data0[4] - data0[0],
      data0[5] - data0[1],
      data0[6] - data0[2],
    );
    const axis = new Vector3(data1[0], data1[1], data1[2]);

    expect(separation.length()).toBeCloseTo(0.18, 5);
    expect(Vector3.Dot(separation, axis)).toBeCloseTo(0, 5);
    expect(Vector3.Dot(separation, normal)).toBeCloseTo(0, 5);
  });

  it("double bond sub-instances should be offset from center", () => {
    const { atoms, bonds } = makeBlocks(2, [{ i: 0, j: 1, order: 2 }]);
    // Place atoms far apart along X to get a clear bond direction
    const atomBlock = atoms;
    atomBlock.setColF("x", new Float64Array([0, 10]));
    const atomColor = makeAtomColor(2);
    const result = buildBondBuffers(bonds, atomBlock, atomColor, 42);
    const data0 = getBuffer(result, "instanceData0");
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
    const pick = getBuffer(result, "instancePickingColor");
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

describe("refreshBondPositions", () => {
  it("updates frame-segment bonds when edit count is 0", () => {
    // After a full pipeline draw, ImpostorState has frameOffset=N and count=0.
    // Regression: using only `count` left sticks frozen while atoms moved.
    const { atoms, bonds } = makeBlocks(2, [{ i: 0, j: 1, order: 1 }]);
    atoms.setColF("x", new Float64Array([0, 2]));
    atoms.setColF("y", new Float64Array([0, 0]));
    atoms.setColF("z", new Float64Array([0, 0]));
    const built = buildBondBuffers(bonds, atoms, makeAtomColor(2), 1);
    expect(built).toBeDefined();
    const matrix = built!.buffers.get("matrix")!;
    const d0 = built!.buffers.get("instanceData0")!;
    const d1 = built!.buffers.get("instanceData1")!;
    // Seed with stale geometry (center at origin, wrong length).
    matrix.fill(0);
    d0.fill(0);
    d1.fill(0);
    d0[3] = 0.1; // radius slot

    const uploads: string[] = [];
    const bondState = {
      count: 0,
      frameOffset: 1,
      buffers: new Map([
        ["matrix", { data: matrix }],
        ["instanceData0", { data: d0 }],
        ["instanceData1", { data: d1 }],
      ]),
      uploadBuffer(name: string) {
        uploads.push(name);
      },
    };

    const x = new Float64Array([0, 4]);
    const y = new Float64Array([0, 0]);
    const z = new Float64Array([0, 0]);
    refreshBondPositions(bonds, x, y, z, bondState);

    expect(d0[0]).toBeCloseTo(2, 5); // midpoint x
    expect(d1[3]).toBeCloseTo(4, 5); // length
    expect(uploads).toEqual(
      expect.arrayContaining(["matrix", "instanceData0", "instanceData1"]),
    );
  });

  it("holds benzene double bonds in the ring plane across a frame advance", () => {
    // Regression: the refresh path derived its own perpendicular frame, so a
    // trajectory step swung every double-bond stroke out of the ring plane
    // that the initial draw had put it in.
    const { atoms, bonds, normal } = makeBenzene();
    const built = buildBondBuffers(bonds, atoms, makeAtomColor(6), 1);
    const matrix = built!.buffers.get("matrix")!;
    const d0 = built!.buffers.get("instanceData0")!;
    const d1 = built!.buffers.get("instanceData1")!;

    const bondState = {
      count: 0,
      frameOffset: built!.instanceCount,
      buffers: new Map([
        ["matrix", { data: matrix }],
        ["instanceData0", { data: d0 }],
        ["instanceData1", { data: d1 }],
      ]),
      uploadBuffer() {},
    };

    // Next frame: the ring translates rigidly, so its plane only shifts.
    const shift = new Vector3(3, -1, 2);
    const x = Float64Array.from(atoms.viewColF("x")!, (v) => v + shift.x);
    const y = Float64Array.from(atoms.viewColF("y")!, (v) => v + shift.y);
    const z = Float64Array.from(atoms.viewColF("z")!, (v) => v + shift.z);
    refreshBondPositions(bonds, x, y, z, bondState);

    const planeOffset = Vector3.Dot(shift, normal);
    for (let s = 0; s < built!.instanceCount; s++) {
      const centre = new Vector3(d0[s * 4 + 0], d0[s * 4 + 1], d0[s * 4 + 2]);
      expect(Vector3.Dot(centre, normal)).toBeCloseTo(planeOffset, 5);
    }
    const separation = new Vector3(d0[4] - d0[0], d0[5] - d0[1], d0[6] - d0[2]);
    expect(separation.length()).toBeCloseTo(0.18, 5);
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
    bondsBlock.setColU32("bond_type", new Uint32Array([1]));
    bondsBlock.setColU32("bond_number", new Uint32Array([1]));
    const atomColor = makeAtomColor(2);
    const box = Box.cube(10, new Float64Array([0, 0, 0]), true, true, true);

    const noPbc = buildBondBuffers(bondsBlock, atoms, atomColor, 42);
    expect(getBuffer(noPbc, "instanceData1")[3]).toBeCloseTo(9, 3);

    const withPbc = buildBondBuffers(bondsBlock, atoms, atomColor, 42, {
      miDisplacements: miDisplacementsViaBox(box, atoms, bondsBlock),
    });
    const d0 = getBuffer(withPbc, "instanceData0");
    const d1 = getBuffer(withPbc, "instanceData1");
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
    bondsBlock.setColU32("bond_type", new Uint32Array([1]));
    bondsBlock.setColU32("bond_number", new Uint32Array([1]));
    const atomColor = makeAtomColor(2);
    const box = Box.cube(10, new Float64Array([0, 0, 0]), true, true, true);

    const result = buildBondBuffers(bondsBlock, atoms, atomColor, 42, {
      miDisplacements: miDisplacementsViaBox(box, atoms, bondsBlock),
    });
    expect(getBuffer(result, "instanceData1")[3]).toBeCloseTo(2, 3);
    expect(getBuffer(result, "instanceData0")[0]).toBeCloseTo(5, 3);
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
    bondsBlock.setColU32("bond_type", new Uint32Array([1]));
    bondsBlock.setColU32("bond_number", new Uint32Array([1]));
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
    const d1 = getBuffer(result, "instanceData1");
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
    bondsBlock.setColU32("bond_type", new Uint32Array([1]));
    bondsBlock.setColU32("bond_number", new Uint32Array([1]));
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
    expect(getBuffer(result, "instanceData1")[3]).toBeCloseTo(2.588, 2);
    box.free();
  });
});
