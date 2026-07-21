import { Block, Frame } from "@molcrafts/molrs";
import type { SceneIndex } from "./scene_index";
import { logger } from "./utils/logger";

export interface BuildFrameFromSceneOptions {
  /**
   * Source frame to carry the simulation box over from. The box is moved into
   * the new frame via the `box` getter→setter (the proven, leak-free pattern
   * used by pipeline modifiers); the source frame keeps its own box.
   */
  sourceFrame?: Frame;
  markSaved?: boolean;
}

/**
 * Build a NEW Frame from the current scene state (SceneIndex MetaRegistry).
 *
 * Returns a fresh Frame rather than mutating one in place — the previous
 * `syncSceneToFrame(frame)` called `frame.clear()` on the live `system.frame`,
 * which violated immutability and could corrupt the source if a write threw
 * mid-rebuild. Callers swap the returned frame into the System.
 */
export function buildFrameFromScene(
  sceneIndex: SceneIndex,
  options: BuildFrameFromSceneOptions = {},
): Frame {
  const frame = new Frame();

  const atoms: Array<{ x: number; y: number; z: number; element: string }> = [];
  const bonds: Array<{ atomId1: number; atomId2: number; order: number }> = [];

  // Atom IDs may be sparse (deletions in edit mode); Frame blocks are dense
  // 0..N, so re-index while collecting.
  const atomIdToFrameIndex = new Map<number, number>();

  // 1. Collect Atoms
  for (const atomId of sceneIndex.metaRegistry.atoms.getAllIds()) {
    const meta = sceneIndex.metaRegistry.atoms.getMeta(atomId);
    if (!meta) continue;

    atomIdToFrameIndex.set(atomId, atoms.length);
    atoms.push({
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
      bonds.push({ atomId1: idx1, atomId2: idx2, order: meta.order });
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
    const orderArr = new Uint32Array(bondCount);

    for (let idx = 0; idx < bonds.length; idx++) {
      const bond = bonds[idx];
      iArr[idx] = bond.atomId1;
      jArr[idx] = bond.atomId2;
      orderArr[idx] = bond.order;
    }

    bondBlock.setColU32("atomi", iArr);
    bondBlock.setColU32("atomj", jArr);
    bondBlock.setColU32("order", orderArr);

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

  return frame;
}
