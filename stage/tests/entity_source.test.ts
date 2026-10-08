import { Block, Frame } from "@molcrafts/molvis-core/molrs";
import { describe, expect, it } from "@rstest/core";
import "./setup_wasm";
import { toDomainUint } from "@molcrafts/molvis-core";
import { AtomSource, BondSource } from "../src/entity_source";
import { BOND_TYPE_AROMATIC, BOND_TYPE_SINGLE } from "../src/utils/bond_order";

/** Two atoms at (0,0,0) and (1,2,3); one bond 1→0. PerceiveBonds writes only atomi/atomj. */
function diatomicFrame(bondType?: number, bondNumber?: number): Frame {
  const frame = new Frame();
  const atoms = new Block();
  atoms.set("x", new Float64Array([0, 1]));
  atoms.set("y", new Float64Array([0, 2]));
  atoms.set("z", new Float64Array([0, 3]));
  frame.set("atoms", atoms);

  const bonds = new Block();
  bonds.set("atomi", toDomainUint([1]));
  bonds.set("atomj", toDomainUint([0]));
  if (bondType !== undefined) {
    bonds.set("bond_type", toDomainUint([bondType]));
  }
  if (bondNumber !== undefined) {
    bonds.set("bond_number", toDomainUint([bondNumber]));
  }
  frame.set("bonds", bonds);
  return frame;
}

describe("BondSource.getMeta", () => {
  // ── Basics ──────────────────────────────────────────────────────────────
  it("does not throw when bonds have only atomi/atomj and defaults to a single bond", () => {
    const src = new BondSource();
    src.setFrame(diatomicFrame());
    expect(() => src.getMeta(0)).not.toThrow();
    expect(src.getMeta(0)).toEqual({
      type: "bond",
      bondId: 0,
      atomId1: 1,
      atomId2: 0,
      bondType: BOND_TYPE_SINGLE,
      bondNumber: BOND_TYPE_SINGLE,
      start: { x: 1, y: 2, z: 3 },
      end: { x: 0, y: 0, z: 0 },
    });
  });

  it("reads bond_type and bond_number when both columns are present", () => {
    const src = new BondSource();
    src.setFrame(diatomicFrame(BOND_TYPE_AROMATIC, 0));
    expect(src.getMeta(0)).toEqual({
      type: "bond",
      bondId: 0,
      atomId1: 1,
      atomId2: 0,
      bondType: BOND_TYPE_AROMATIC,
      bondNumber: 0,
      start: { x: 1, y: 2, z: 3 },
      end: { x: 0, y: 0, z: 0 },
    });
  });

  // ── Edge ────────────────────────────────────────────────────────────────
  it("defaults bondNumber to type for 1–3 when bond_number is absent", () => {
    const src = new BondSource();
    src.setFrame(diatomicFrame(2));
    expect(() => src.getMeta(0)).not.toThrow();
    const meta = src.getMeta(0);
    expect(meta).not.toBeNull();
    expect(meta?.bondType).toBe(2);
    expect(meta?.bondNumber).toBe(2);
    expect(meta?.atomId1).toBe(1);
    expect(meta?.atomId2).toBe(0);
    expect(Number.isFinite(meta?.start.x)).toBe(true);
    expect(Number.isFinite(meta?.end.z)).toBe(true);
  });

  it("defaults bondNumber to 0 for aromatic when bond_number is absent", () => {
    const src = new BondSource();
    src.setFrame(diatomicFrame(BOND_TYPE_AROMATIC));
    expect(() => src.getMeta(0)).not.toThrow();
    const meta = src.getMeta(0);
    expect(meta?.bondType).toBe(BOND_TYPE_AROMATIC);
    expect(meta?.bondNumber).toBe(0);
  });
});

describe("AtomSource copy-on-write overlay", () => {
  /**
   * Entering Edit mode used to copy every frame atom into the edit map so the
   * frame source could be dropped (35.6 s for 500 000 atoms). The overlay now
   * stays lazy, which only works if a deletion is recorded beside the frame
   * block — a frame row cannot be removed from it.
   */
  function threeAtomSource(): AtomSource {
    const frame = new Frame();
    const atoms = new Block();
    atoms.set("x", new Float64Array([0, 1, 2]));
    atoms.set("y", new Float64Array([0, 0, 0]));
    atoms.set("z", new Float64Array([0, 0, 0]));
    atoms.set("element", ["C", "C", "O"]);
    frame.set("atoms", atoms);
    const source = new AtomSource();
    source.setFrame(frame);
    return source;
  }

  it("reads unedited atoms straight from the frame — no copy needed", () => {
    const source = threeAtomSource();
    expect(source.edits.size).toBe(0);
    expect(source.getMeta(2)?.element).toBe("O");
    expect([...source.getAllIds()]).toEqual([0, 1, 2]);
  });

  it("keeps a deleted frame atom deleted", () => {
    const source = threeAtomSource();
    source.removeEdit(1);

    // Without the tombstone the frame block would hand row 1 straight back,
    // and the next commit would resurrect the atom the user deleted.
    expect(source.getMeta(1)).toBeNull();
    expect([...source.getAllIds()]).toEqual([0, 2]);
  });

  it("an edit on a deleted id revives it", () => {
    const source = threeAtomSource();
    source.removeEdit(1);
    source.setEdit(1, {
      type: "atom",
      atomId: 1,
      element: "N",
      position: { x: 9, y: 9, z: 9 },
    });

    expect(source.getMeta(1)?.element).toBe("N");
    expect([...source.getAllIds()]).toEqual([0, 1, 2]);
  });

  it("a new frame clears stale tombstones", () => {
    const source = threeAtomSource();
    source.removeEdit(0);
    expect([...source.getAllIds()]).toEqual([1, 2]);

    source.setFrame(threeAtomSource().frame);
    expect([...source.getAllIds()]).toEqual([0, 1, 2]);
  });
});
