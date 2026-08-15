import { Block, Frame } from "@molcrafts/molvis-core/molrs";
import { AtomColumnCarrier } from "./atom_columns";
import type { SceneIndex } from "./scene_index";
import { setBondTopology } from "./utils/bond_order";
import { logger } from "./utils/logger";

export interface BuildFrameFromSceneOptions {
  /**
   * Source frame the committed frame inherits from: its simulation box, and
   * every atom column the scene itself does not carry (charge, `mol_id`,
   * residue fields, …). The box is moved into the new frame via the `box`
   * getter→setter (the proven, leak-free pattern used by pipeline modifiers);
   * the source frame keeps its own box, and its atoms block is only read.
   */
  sourceFrame?: Frame;
  markSaved?: boolean;
}

/**
 * Materialized Frame plus scene→dense-row maps.
 *
 * Scene atom/bond ids may be sparse (edit pool). Frame blocks are always dense
 * `0..N-1`. Callers that must preserve selection or selection-export identity
 * across commit use these maps — never assume scene id === frame row.
 */
export interface MaterializedSceneFrame {
  frame: Frame;
  /** Scene logical atom id → dense atoms-block row. */
  atomIdToFrameIndex: Map<number, number>;
  /** Scene logical bond id → dense bonds-block row. */
  bondIdToFrameIndex: Map<number, number>;
}

/**
 * Build a NEW Frame from the current scene state (SceneIndex MetaRegistry).
 *
 * Returns a fresh Frame rather than mutating one in place — the previous
 * `syncSceneToFrame(frame)` called `frame.clear()` on the live `system.frame`,
 * which violated immutability and could corrupt the source if a write threw
 * mid-rebuild. Callers swap the returned frame into the System.
 *
 * Prefer {@link materializeFrameFromScene} when you need id remaps (commit,
 * get_selected).
 */
export function buildFrameFromScene(
  sceneIndex: SceneIndex,
  options: BuildFrameFromSceneOptions = {},
): Frame {
  return materializeFrameFromScene(sceneIndex, options).frame;
}

/**
 * Same as {@link buildFrameFromScene}, but also returns scene→dense id maps.
 */
export function materializeFrameFromScene(
  sceneIndex: SceneIndex,
  options: BuildFrameFromSceneOptions = {},
): MaterializedSceneFrame {
  const frame = new Frame();

  // `id` is the scene atom id this dense row came from — the inverse of
  // `atomIdToFrameIndex`, needed to look the row's source-frame columns back up.
  const atoms: Array<{
    id: number;
    x: number;
    y: number;
    z: number;
    element: string;
  }> = [];
  const bonds: Array<{
    atomId1: number;
    atomId2: number;
    bondType: number;
    bondNumber: number;
  }> = [];

  // Atom IDs may be sparse (deletions in edit mode); Frame blocks are dense
  // 0..N, so re-index while collecting.
  const atomIdToFrameIndex = new Map<number, number>();
  const bondIdToFrameIndex = new Map<number, number>();

  // 1. Collect Atoms
  for (const atomId of sceneIndex.metaRegistry.atoms.getAllIds()) {
    const meta = sceneIndex.metaRegistry.atoms.getMeta(atomId);
    if (!meta) continue;

    atomIdToFrameIndex.set(atomId, atoms.length);
    atoms.push({
      id: atomId,
      x: meta.position.x,
      y: meta.position.y,
      z: meta.position.z,
      element: meta.element,
    });
  }

  // 2. Collect Bonds
  let droppedBonds = 0;
  for (const bondId of sceneIndex.metaRegistry.bonds.getAllIds()) {
    const meta = sceneIndex.metaRegistry.bonds.getMeta(bondId);
    if (!meta) continue;

    const idx1 = atomIdToFrameIndex.get(meta.atomId1);
    const idx2 = atomIdToFrameIndex.get(meta.atomId2);

    if (idx1 !== undefined && idx2 !== undefined) {
      bondIdToFrameIndex.set(bondId, bonds.length);
      bonds.push({
        atomId1: idx1,
        atomId2: idx2,
        bondType: meta.bondType,
        bondNumber: meta.bondNumber,
      });
    } else {
      // Bond endpoint refers to an atom that no longer exists (e.g. deleted in
      // edit mode). Drop it, but never silently — a save that loses topology
      // should be observable.
      droppedBonds++;
    }
  }

  // 3. Populate Frame
  const atomCount = atoms.length;
  if (atomCount > 0) {
    const atomBlock = new Block();
    const x = new Float64Array(atomCount);
    const y = new Float64Array(atomCount);
    const z = new Float64Array(atomCount);
    const elements: string[] = [];

    for (let i = 0; i < atoms.length; i++) {
      const atom = atoms[i];
      x[i] = atom.x;
      y[i] = atom.y;
      z[i] = atom.z;
      elements.push(atom.element);
    }

    // Carry the source frame's atom columns (charge, mol_id, residue fields, …)
    // first, then overwrite the columns this path owns — a commit that only
    // wrote x/y/z/element silently dropped everything else.
    //
    // Row rule: a dense row's scene atom id IS its source row while that id is
    // inside the source frame's row range. Scene ids stay stable across canvas
    // edits (deletes leave holes, adds continue past the last frame row), so
    // this one rule covers sparse-after-delete and grown-after-add alike; an id
    // at or past `nrows()` is an atom the source frame never had, and the
    // carrier zero-fills it. The block is a borrow out of `sourceFrame` — read
    // only, never freed here.
    const sourceAtoms = options.sourceFrame?.getBlock("atoms");
    if (sourceAtoms) {
      const sourceRows = sourceAtoms.nrows();
      new AtomColumnCarrier(sourceAtoms).copyInto(
        atomBlock,
        atomCount,
        (row) => (atoms[row].id < sourceRows ? atoms[row].id : undefined),
      );
    }

    atomBlock.setColF("x", x);
    atomBlock.setColF("y", y);
    atomBlock.setColF("z", z);
    atomBlock.setColStr("element", elements);

    frame.insertBlock("atoms", atomBlock);
  }

  const bondCount = bonds.length;
  if (bondCount > 0) {
    const bondBlock = new Block();
    const iArr = new Uint32Array(bondCount);
    const jArr = new Uint32Array(bondCount);
    const typeArr = new Uint32Array(bondCount);
    const numberArr = new Uint32Array(bondCount);

    for (let idx = 0; idx < bonds.length; idx++) {
      const bond = bonds[idx];
      iArr[idx] = bond.atomId1;
      jArr[idx] = bond.atomId2;
      typeArr[idx] = bond.bondType;
      numberArr[idx] = bond.bondNumber;
    }

    setBondTopology(bondBlock, iArr, jArr, typeArr, numberArr);
    frame.insertBlock("bonds", bondBlock);
  }

  // Preserve the simulation box. `sourceFrame.box` (getter) returns a copy;
  // assigning it (setter) MOVES it into the new frame and leaves the source's
  // own box intact — the same pattern pipeline modifiers use. This fixes the
  // long-standing box-loss on save.
  const sourceBox = options.sourceFrame?.box;
  if (sourceBox) {
    frame.box = sourceBox;
  }

  logger.info(
    `[buildFrameFromScene] Built ${atomCount} atoms and ${bondCount} bonds.`,
  );
  if (droppedBonds > 0) {
    logger.warn(
      `[buildFrameFromScene] Dropped ${droppedBonds} bond(s) referencing deleted atoms.`,
    );
  }
  if (options.markSaved !== false) {
    sceneIndex.markAllSaved();
  }

  return { frame, atomIdToFrameIndex, bondIdToFrameIndex };
}
