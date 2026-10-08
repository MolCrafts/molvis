import { toDomainUint } from "@molcrafts/molvis-core";
import { Block, Box, Frame } from "@molcrafts/molvis-core/molrs";
import { describe, expect, it } from "@rstest/core";
import "./setup_wasm";
import { AtomSource, BondSource } from "../src/entity_source";
import type { SceneIndex } from "../src/scene_index";
import {
  buildFrameFromScene,
  materializeFrameFromScene,
} from "../src/scene_sync";

// buildFrameFromScene only touches sceneIndex.metaRegistry.{atoms,bonds} and
// markAllSaved(), so a mock backed by real AtomSource/BondSource suffices —
// no BabylonJS scene needed.
function mockSceneIndex(atoms: AtomSource, bonds: BondSource): SceneIndex {
  return {
    metaRegistry: { atoms, bonds },
    markAllSaved() {},
  } as unknown as SceneIndex;
}

function sceneWith3Atoms(): SceneIndex {
  const atoms = new AtomSource();
  atoms.setEdit(0, {
    type: "atom",
    atomId: 0,
    element: "C",
    position: { x: 1, y: 2, z: 3 },
  });
  atoms.setEdit(1, {
    type: "atom",
    atomId: 1,
    element: "H",
    position: { x: 4, y: 5, z: 6 },
  });
  const bonds = new BondSource();
  bonds.setEdit(0, {
    type: "bond",
    bondId: 0,
    atomId1: 0,
    atomId2: 1,
    bondType: 2,
    bondNumber: 2,
    start: { x: 1, y: 2, z: 3 },
    end: { x: 4, y: 5, z: 6 },
  });
  return mockSceneIndex(atoms, bonds);
}

/**
 * Source frame carrying non-coordinate atom columns (`charge` f64, `mol_id`
 * u32) next to the x/y/z/element the commit path already writes. Atoms sit on
 * the x axis at `x = row` so a row shift is visible in the coordinates too.
 */
function chargedSourceFrame(
  elements: readonly string[],
  charge: readonly number[],
  molId: readonly number[],
): Frame {
  const count = elements.length;
  const frame = new Frame();
  const block = new Block();
  const x = new Float64Array(count);
  for (let i = 0; i < count; i++) x[i] = i;
  block.set("x", x);
  block.set("y", new Float64Array(count));
  block.set("z", new Float64Array(count));
  block.set("element", [...elements]);
  block.set("charge", Float64Array.from(charge));
  block.set("mol_id", toDomainUint(molId));
  frame.set("atoms", block);
  return frame;
}

/** `keys()` is typed `Array<any>` in molrs; narrow at the boundary. */
function atomKeys(frame: Frame): string[] {
  return frame.get("atoms").keys();
}

describe("buildFrameFromScene", () => {
  it("builds a new Frame with the scene's atoms and bonds", () => {
    const frame = buildFrameFromScene(sceneWith3Atoms());
    const a = frame.has("atoms") ? frame.get("atoms") : undefined;
    expect(a?.nRows).toBe(2);
    const x = a?.view("x") as Float64Array;
    expect(x && Array.from(x)).toEqual([1, 4]);
    const b = frame.has("bonds") ? frame.get("bonds") : undefined;
    expect(b?.nRows).toBe(1);
    expect(Number((b?.view("bond_type") as BigUint64Array)?.[0])).toBe(2);
    expect(Number((b?.view("bond_number") as BigUint64Array)?.[0])).toBe(2);
  });

  it("preserves BondMeta aromatic bond_type=4, bond_number=0", () => {
    const atoms = new AtomSource();
    atoms.setEdit(0, {
      type: "atom",
      atomId: 0,
      element: "C",
      position: { x: 0, y: 0, z: 0 },
    });
    atoms.setEdit(1, {
      type: "atom",
      atomId: 1,
      element: "C",
      position: { x: 1.4, y: 0, z: 0 },
    });
    const bonds = new BondSource();
    bonds.setEdit(0, {
      type: "bond",
      bondId: 0,
      atomId1: 0,
      atomId2: 1,
      bondType: 4,
      bondNumber: 0,
      start: { x: 0, y: 0, z: 0 },
      end: { x: 1.4, y: 0, z: 0 },
    });

    const frame = buildFrameFromScene(mockSceneIndex(atoms, bonds));
    const b = frame.has("bonds") ? frame.get("bonds") : undefined;
    expect(Number((b?.view("bond_type") as BigUint64Array)?.[0])).toBe(4);
    expect(Number((b?.view("bond_number") as BigUint64Array)?.[0])).toBe(0);
  });

  it("preserves the simulation box from the source frame", () => {
    const sourceFrame = new Frame();
    sourceFrame.box = Box.cube(
      10,
      new Float64Array([0, 0, 0]),
      true,
      true,
      true,
    );
    const frame = buildFrameFromScene(sceneWith3Atoms(), { sourceFrame });
    expect(frame.box).toBeTruthy();
    // The source frame keeps its own box (getter→setter move pattern).
    expect(sourceFrame.box).toBeTruthy();
  });

  it("does NOT mutate/clear the source frame (immutability)", () => {
    const sourceFrame = new Frame();
    sourceFrame.box = Box.cube(
      5,
      new Float64Array([0, 0, 0]),
      true,
      true,
      true,
    );
    buildFrameFromScene(sceneWith3Atoms(), { sourceFrame });
    // Source frame must remain usable and box intact after the build.
    expect(() => sourceFrame.box).not.toThrow();
    expect(sourceFrame.box).toBeTruthy();
  });

  it("materializeFrameFromScene maps sparse edit ids to dense rows", () => {
    const atoms = new AtomSource();
    atoms.setEdit(10, {
      type: "atom",
      atomId: 10,
      element: "C",
      position: { x: 1, y: 0, z: 0 },
    });
    atoms.setEdit(20, {
      type: "atom",
      atomId: 20,
      element: "O",
      position: { x: 2, y: 0, z: 0 },
    });
    const bonds = new BondSource();
    bonds.setEdit(7, {
      type: "bond",
      bondId: 7,
      atomId1: 10,
      atomId2: 20,
      bondType: 1,
      bondNumber: 1,
      start: { x: 1, y: 0, z: 0 },
      end: { x: 2, y: 0, z: 0 },
    });

    const built = materializeFrameFromScene(mockSceneIndex(atoms, bonds));
    expect(built.frame.get("atoms").nRows).toBe(2);
    expect(built.atomIdToFrameIndex.get(10)).toBe(0);
    expect(built.atomIdToFrameIndex.get(20)).toBe(1);
    expect(built.bondIdToFrameIndex.get(7)).toBe(0);
    // Endpoints renumbered into dense atom rows.
    expect(
      Number((built.frame.get("bonds").view("atomi") as BigUint64Array)?.[0]),
    ).toBe(0);
    expect(
      Number((built.frame.get("bonds").view("atomj") as BigUint64Array)?.[0]),
    ).toBe(1);
  });

  // ── spec optimize-staging-02-columns ──────────────────────────────────────
  // Commit must carry the source frame's atom columns over, not just
  // x/y/z/element. Float goldens use toBeCloseTo(…, 6) because the column's
  // storage width is molrs's float-build choice ("f32" or "f64"); 1e-6 still
  // separates every golden here by three orders of magnitude.

  it("keeps source atom columns on commit and zero-fills an added atom", () => {
    const sourceFrame = chargedSourceFrame(
      ["O", "H", "H"],
      [-0.834, 0.417, 0.417],
      [1, 1, 1],
    );
    const atoms = new AtomSource();
    atoms.setFrame(sourceFrame);
    // Edit-pool atom drawn on canvas after load: id 3 is past the source's
    // last row (nrows() === 3), so it has no source row at all.
    atoms.setEdit(3, {
      type: "atom",
      atomId: 3,
      element: "H",
      position: { x: 9, y: 0, z: 0 },
    });

    const built = materializeFrameFromScene(
      mockSceneIndex(atoms, new BondSource()),
      { sourceFrame },
    );

    const out = built.frame.has("atoms") ? built.frame.get("atoms") : undefined;
    expect(out?.nRows).toBe(4);
    expect(atomKeys(built.frame)).toContain("charge");
    expect(atomKeys(built.frame)).toContain("mol_id");

    const charge = out?.copy("charge") as Float64Array;
    expect(charge?.[0]).toBeCloseTo(-0.834, 6);
    expect(charge?.[1]).toBeCloseTo(0.417, 6);
    expect(charge?.[2]).toBeCloseTo(0.417, 6);
    expect(charge?.[3]).toBeCloseTo(0, 6);

    const molId = out?.copy("mol_id") as BigUint64Array;
    expect(molId && Array.from(molId, Number)).toEqual([1, 1, 1, 0]);

    // The columns the commit path owns still win — the carrier runs first and
    // x/y/z/element are written over it.
    const x = out?.view("x") as Float64Array;
    expect(x && Array.from(x)).toEqual([0, 1, 2, 9]);
    expect([...(out?.copy("element") as string[])]).toEqual([
      "O",
      "H",
      "H",
      "H",
    ]);
  });

  it("keeps each surviving row on its own source row after a middle delete", () => {
    const sourceFrame = chargedSourceFrame(
      ["O", "H", "H", "O"],
      [-0.834, 0.417, 0.417, -0.834],
      [10, 11, 12, 13],
    );
    // Deleting in edit mode promotes the frame into the edit pool first
    // (SceneIndex.promoteFrameToEditPool → setEdit per row, setFrame(null)),
    // so survivors keep their ORIGINAL scene ids: 1 is gone, 0/2/3 remain and
    // land on dense rows 0/1/2.
    const atoms = new AtomSource();
    const survivors: ReadonlyArray<readonly [number, string]> = [
      [0, "O"],
      [2, "H"],
      [3, "O"],
    ];
    for (const [id, element] of survivors) {
      atoms.setEdit(id, {
        type: "atom",
        atomId: id,
        element,
        position: { x: id, y: 0, z: 0 },
      });
    }

    const built = materializeFrameFromScene(
      mockSceneIndex(atoms, new BondSource()),
      { sourceFrame },
    );

    const out = built.frame.has("atoms") ? built.frame.get("atoms") : undefined;
    expect(out?.nRows).toBe(3);
    expect(built.atomIdToFrameIndex.get(2)).toBe(1);
    expect(built.atomIdToFrameIndex.get(3)).toBe(2);
    expect(atomKeys(built.frame)).toContain("charge");
    expect(atomKeys(built.frame)).toContain("mol_id");

    // Off-by-one (dense row read straight out of the source) would give
    // [10, 11, 12] / [-0.834, 0.417, 0.417] here.
    const molId = out?.copy("mol_id") as BigUint64Array;
    expect(molId && Array.from(molId, Number)).toEqual([10, 12, 13]);

    const charge = out?.copy("charge") as Float64Array;
    expect(charge?.[0]).toBeCloseTo(-0.834, 6);
    expect(charge?.[1]).toBeCloseTo(0.417, 6);
    expect(charge?.[2]).toBeCloseTo(-0.834, 6);
  });
});
