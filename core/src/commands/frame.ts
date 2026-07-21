import * as BABYLON from "@babylonjs/core";
import type { Block, Frame } from "@molcrafts/molrs";
import type { MolvisApp } from "../app";
import { viewAtomCoords } from "../io/atom_coords";
import { buildFrameFromScene } from "../scene_sync";
import { DType } from "../utils/dtype";
import { Command, command } from "./base";

export interface UpdateFrameResult {
  success: boolean;
  reason?: string;
}

interface FrameDataBlock {
  x?: number[];
  y?: number[];
  z?: number[];
  element?: string[];
  atomi?: number[];
  atomj?: number[];
  order?: number[];
}

type FrameDataBlocks = Record<string, FrameDataBlock>;

// Reusable scratch variables from update_frame.ts
const TMP_VEC_0 = new BABYLON.Vector3();
const TMP_VEC_1 = new BABYLON.Vector3();
const TMP_VEC_2 = new BABYLON.Vector3();
const TMP_VEC_CENTER = new BABYLON.Vector3();
const TMP_VEC_DIR = new BABYLON.Vector3();
const TMP_VEC_AXIS = new BABYLON.Vector3();
const TMP_MAT = BABYLON.Matrix.Identity();
const TMP_QUAT = BABYLON.Quaternion.Identity();
const UP_VECTOR = new BABYLON.Vector3(0, 1, 0);

/**
 * Command to create a new frame and set it as current.
 */
@command("new_frame")
export class NewFrameCommand extends Command<void> {
  private clear: boolean;
  private frameName?: string;

  constructor(app: MolvisApp, args: { name?: string; clear?: boolean }) {
    super(app);
    this.frameName = args.name;
    this.clear = args.clear ?? true;
  }

  do(): void {
    const index = this.app.world.sceneIndex;
    if (this.clear) {
      index.clear();
      this.app.artist.clear();
    }
    // Frame naming is retained for forward compatibility but not persisted in v0.0.2.
    void this.frameName;
  }

  undo(): Command {
    return this; // Cannot undo clear easily without massive state save
  }
}

/**
 * Command to incrementally update the scene with a new frame.
 */
@command("update_frame")
export class UpdateFrameCommand extends Command<UpdateFrameResult> {
  private frame?: Frame;

  constructor(app: MolvisApp, args: { frame: Frame }) {
    super(app);
    this.frame = args.frame;
  }

  async do(): Promise<UpdateFrameResult> {
    if (!this.frame) {
      return { success: false, reason: "No frame provided" };
    }

    const sceneIndex = this.app.world.sceneIndex;

    // sceneIndex is the source of truth for registered atom/bond state.
    // artist.atomMesh can briefly diverge (e.g. after artist.clear() recreates
    // the mesh but a pipeline path takes a non-registering redraw branch).
    // Target the mesh owned by the registered ImpostorState directly.
    const atomState = sceneIndex.meshRegistry.getAtomState();
    const bondState = sceneIndex.meshRegistry.getBondState();

    if (!atomState) {
      return { success: false, reason: "No registered atom state" };
    }
    const atomMesh = atomState.mesh;
    const bondMesh = bondState?.mesh;

    const frameAtoms = this.frame.getBlock("atoms");
    if (!frameAtoms) {
      return { success: false, reason: "Frame has no atoms" };
    }

    const currentAtomCount = atomMesh.thinInstanceCount;
    const newAtomCount = frameAtoms.nrows();
    if (currentAtomCount !== newAtomCount) {
      return {
        success: false,
        reason: `Atom count mismatch: current=${currentAtomCount}, new=${newAtomCount}`,
      };
    }

    const frameBonds = this.frame.getBlock("bonds");
    const currentBondCount = bondMesh?.thinInstanceCount ?? 0;
    const newBondCount = frameBonds ? frameBonds.nrows() : 0;
    if (currentBondCount !== newBondCount) {
      return {
        success: false,
        reason: `Bond count mismatch: current=${currentBondCount}, new=${newBondCount}`,
      };
    }

    // NOTE: frameAtoms/frameBonds are getBlock wrappers and are deliberately
    // NOT freed — freeing a getBlock/box handle corrupts the frame's shared
    // data on subsequent reads (see memory: project_molrs_handle_ownership).
    // Internal buffer checks inside updateAtomBuffer / updateBondBuffer still
    // throw on soft failures (buffer missing, frame offset mismatch). Translate
    // those into `{success: false}` so the caller falls back to DrawFrameCommand.
    try {
      this.updateAtomBuffer(atomMesh, frameAtoms);

      if (bondMesh && frameBonds) {
        this.updateBondBuffer(bondMesh, frameAtoms, frameBonds);
      }

      sceneIndex.metaRegistry.atoms.setFrame(this.frame);
      if (frameBonds) {
        sceneIndex.metaRegistry.bonds.setFrame(this.frame);
      }

      this.app.artist.redrawFromSceneIndex(this.frame);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private updateAtomBuffer(mesh: BABYLON.Mesh, atomsBlock: Block) {
    const count = atomsBlock.nrows();
    if (!count) throw new Error("Atoms block has no rows");
    const xCoords = atomsBlock.viewColF("x");
    if (!xCoords) throw new Error("Missing x coordinates");
    const yCoords = atomsBlock.viewColF("y");
    if (!yCoords) throw new Error("Missing y coordinates");
    const zCoords = atomsBlock.viewColF("z");
    if (!zCoords) throw new Error("Missing z coordinates");
    // `mesh` is already atomState.mesh (caller pulls from sceneIndex).
    const atomState = this.app.world.sceneIndex.meshRegistry.getAtomState();
    if (!atomState) throw new Error("Atom state not registered");
    void mesh;

    // Guard: frame atom count must match the frame segment [0..frameOffset)
    // to prevent writing into the edit segment.
    if (count !== atomState.frameOffset) {
      throw new Error(
        `Frame atom count (${count}) does not match frameOffset (${atomState.frameOffset}). Cannot safely update buffers without overwriting edit data.`,
      );
    }

    // Get buffer from ImpostorState
    const matrixDesc = atomState.buffers.get("matrix");
    if (!matrixDesc) throw new Error("Matrix buffer missing in AtomState");

    const matrixBuffer = matrixDesc.data; // Using the persistent buffer
    if (matrixBuffer.length < count * 16) {
      // Buffer too small? We should probably resize via ImpostorState.
      // But UpdateFrameCommand usually assumes topology matches.
      // If count is same, length should be sufficient if ImpostorState was init correctly.
      // But if ImpostorState was grown for Edits, it's fine.
      throw new Error(
        `Matrix buffer too small: ${matrixBuffer.length} < ${count * 16}`,
      );
    }

    // InstanceData
    const instanceDataDesc = atomState.buffers.get("instanceData");
    if (!instanceDataDesc)
      throw new Error("InstanceData buffer missing in AtomState");
    const instanceDataBuffer = instanceDataDesc.data;

    // Position-only update: radii/scale have not changed, so read the existing
    // radius from instanceData buffer (idx4+3) instead of re-resolving styles.
    // This avoids a costly WASM→JS copyColStr("element") on every frame seek.
    for (let i = 0; i < count; i++) {
      const offset = i * 16;
      const idx4 = i * 4;

      // Read existing radius from instanceData (set during full DrawFrameCommand)
      const radius = instanceDataBuffer[idx4 + 3];
      const scale = radius * 2;

      matrixBuffer[offset + 0] = scale;
      matrixBuffer[offset + 5] = scale;
      matrixBuffer[offset + 10] = scale;
      matrixBuffer[offset + 15] = 1;

      matrixBuffer[offset + 12] = xCoords[i];
      matrixBuffer[offset + 13] = yCoords[i];
      matrixBuffer[offset + 14] = zCoords[i];

      instanceDataBuffer[idx4 + 0] = xCoords[i];
      instanceDataBuffer[idx4 + 1] = yCoords[i];
      instanceDataBuffer[idx4 + 2] = zCoords[i];
      // idx4+3 (radius) unchanged
    }

    // Position-only update: only matrix + instanceData changed. Mark just those
    // dirty so applyStateToMesh skips re-uploading the unchanged color/picking
    // buffers — the per-frame GPU-bandwidth win for large systems.
    atomState.markDirty("matrix", "instanceData");
  }

  private updateBondBuffer(
    mesh: BABYLON.Mesh,
    atomsBlock: Block,
    bondsBlock: Block,
  ) {
    const count = bondsBlock.nrows();
    if (!count) throw new Error("Bonds block has no rows");
    const xCoords = atomsBlock.viewColF("x");
    if (!xCoords) throw new Error("Missing x coordinates");
    const yCoords = atomsBlock.viewColF("y");
    if (!yCoords) throw new Error("Missing y coordinates");
    const zCoords = atomsBlock.viewColF("z");
    if (!zCoords) throw new Error("Missing z coordinates");
    const i_atoms = bondsBlock.viewColU32("atomi");
    if (!i_atoms) throw new Error("Missing bond atomi column");
    const j_atoms = bondsBlock.viewColU32("atomj");
    if (!j_atoms) throw new Error("Missing bond atomj column");

    // Retrieve Bond State
    const bondState = this.app.world.sceneIndex.meshRegistry.getBondState();
    if (!bondState || bondState.mesh !== mesh) {
      throw new Error("Bond state not found or mismatched mesh");
    }

    const matrixBuffer = bondState.buffers.get("matrix")?.data;
    if (!matrixBuffer) throw new Error("Bond matrix buffer missing");

    const data0Buffer = bondState.buffers.get("instanceData0")?.data;
    const data1Buffer = bondState.buffers.get("instanceData1")?.data;
    const useImpostor = !!(data0Buffer && data1Buffer);

    const bondRadius = this.app.styleManager.getBondStyle(1).radius;

    for (let b = 0; b < count; b++) {
      const i = i_atoms[b];
      const j = j_atoms[b];

      TMP_VEC_1.set(xCoords[i], yCoords[i], zCoords[i]); // p1
      TMP_VEC_2.set(xCoords[j], yCoords[j], zCoords[j]); // p2

      // center = (p1 + p2) * 0.5
      TMP_VEC_CENTER.copyFrom(TMP_VEC_1)
        .addInPlace(TMP_VEC_2)
        .scaleInPlace(0.5);

      // direction = (p2 - p1).normalize()
      TMP_VEC_DIR.copyFrom(TMP_VEC_2).subtractInPlace(TMP_VEC_1);
      const distance = TMP_VEC_DIR.length();
      if (distance > 1e-8) {
        TMP_VEC_DIR.scaleInPlace(1 / distance);
      } else {
        TMP_VEC_DIR.set(0, 1, 0);
      }

      if (useImpostor && data0Buffer && data1Buffer) {
        const idx4 = b * 4;
        data0Buffer[idx4 + 0] = TMP_VEC_CENTER.x;
        data0Buffer[idx4 + 1] = TMP_VEC_CENTER.y;
        data0Buffer[idx4 + 2] = TMP_VEC_CENTER.z;
        data0Buffer[idx4 + 3] = bondRadius;

        data1Buffer[idx4 + 0] = TMP_VEC_DIR.x;
        data1Buffer[idx4 + 1] = TMP_VEC_DIR.y;
        data1Buffer[idx4 + 2] = TMP_VEC_DIR.z;
        data1Buffer[idx4 + 3] = distance;

        const matOffset = b * 16;
        const scale = distance + bondRadius * 2;
        matrixBuffer[matOffset + 0] = scale;
        matrixBuffer[matOffset + 5] = scale;
        matrixBuffer[matOffset + 10] = scale;
        matrixBuffer[matOffset + 15] = 1;
        matrixBuffer[matOffset + 12] = TMP_VEC_CENTER.x;
        matrixBuffer[matOffset + 13] = TMP_VEC_CENTER.y;
        matrixBuffer[matOffset + 14] = TMP_VEC_CENTER.z;
      } else {
        // Fast rotation
        const dot = BABYLON.Vector3.Dot(UP_VECTOR, TMP_VEC_DIR);
        if (dot < -0.999999) {
          BABYLON.Quaternion.FromEulerAnglesToRef(Math.PI, 0, 0, TMP_QUAT);
        } else {
          BABYLON.Vector3.CrossToRef(UP_VECTOR, TMP_VEC_DIR, TMP_VEC_AXIS);
          TMP_QUAT.x = TMP_VEC_AXIS.x;
          TMP_QUAT.y = TMP_VEC_AXIS.y;
          TMP_QUAT.z = TMP_VEC_AXIS.z;
          TMP_QUAT.w = 1 + dot;
          TMP_QUAT.normalize();
        }

        TMP_VEC_0.set(bondRadius * 2, distance, bondRadius * 2);
        BABYLON.Matrix.ComposeToRef(
          TMP_VEC_0,
          TMP_QUAT,
          TMP_VEC_CENTER,
          TMP_MAT,
        );

        TMP_MAT.copyToArray(matrixBuffer, b * 16);
      }
    }

    // Position-only update: bond matrix + impostor data changed; colors,
    // split, and picking are unchanged. Mark only the touched buffers dirty.
    bondState.markDirty("matrix", "instanceData0", "instanceData1");
  }

  /**
   * UpdateFrameCommand is not reversible — it is used for transient trajectory
   * playback and is never pushed to the CommandManager history stack.
   */
  undo(): Command {
    throw new Error(
      "UpdateFrameCommand is not reversible. It should not be pushed to command history.",
    );
  }
}

/**
 * Command to export current staged scene data as a plain frame-data payload.
 * Intended for external clients (e.g. python) to reconstruct frame objects.
 */
@command("export_frame")
export class ExportFrameCommand extends Command<{
  frameData: { blocks: FrameDataBlocks; metadata: Record<string, unknown> };
}> {
  do(): {
    frameData: { blocks: FrameDataBlocks; metadata: Record<string, unknown> };
  } {
    const tempFrame = buildFrameFromScene(this.app.world.sceneIndex, {
      markSaved: false,
    });

    const blocks: FrameDataBlocks = {};

    const atomsBlock = tempFrame.getBlock("atoms");
    if (atomsBlock) {
      const coords = viewAtomCoords(atomsBlock);
      const x = coords?.x;
      const y = coords?.y;
      const z = coords?.z;
      const elements =
        atomsBlock.dtype("element") === DType.String
          ? (atomsBlock.copyColStr("element") as string[])
          : undefined;

      if (x && y && z) {
        blocks.atoms = {
          x: Array.from(x),
          y: Array.from(y),
          z: Array.from(z),
          element: elements,
        };
      }
    }

    const bondsBlock = tempFrame.getBlock("bonds");
    if (bondsBlock) {
      const atomi = bondsBlock.viewColU32("atomi");
      const atomj = bondsBlock.viewColU32("atomj");
      const order =
        bondsBlock.dtype("order") === DType.U32
          ? bondsBlock.viewColU32("order")
          : undefined;

      if (atomi && atomj) {
        blocks.bonds = {
          atomi: Array.from(atomi),
          atomj: Array.from(atomj),
          order: order ? Array.from(order) : undefined,
        };
      }
    }

    // Free the temporary WASM Frame to prevent memory leaks
    if (typeof (tempFrame as { free?: () => void }).free === "function") {
      (tempFrame as { free: () => void }).free();
    }

    return { frameData: { blocks, metadata: {} } };
  }

  undo(): Command {
    return this;
  }
}
