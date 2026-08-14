import { Matrix, type Mesh, type Scene, Vector3 } from "@babylonjs/core";
import * as keys from "@molcrafts/molvis-core/keys";
import type { Frame } from "@molcrafts/molvis-core/molrs";
import { type Block, Frame as MolrsFrame } from "@molcrafts/molvis-core/molrs";
import type { MolvisApp } from "../app";
import type { SceneIndex } from "../scene_index";
import { materializeFrameFromScene } from "../scene_sync";
import type { SelectedEntity } from "../selection_manager";
import { Command, command } from "./base";
import { commands } from "./registry";

function getThinInstanceMatrixBuffer(mesh: Mesh): Float32Array | null {
  const storage = (
    mesh as unknown as {
      _thinInstanceDataStorage?: { matrixData?: Float32Array };
    }
  )._thinInstanceDataStorage;
  const buffer = storage?.matrixData ?? null;
  return buffer instanceof Float32Array ? buffer : null;
}

function findThinInstanceMesh(
  scene: Scene,
  sceneIndex: SceneIndex,
  type: "atom" | "bond",
): Mesh | null {
  return (
    (scene.meshes.find((mesh) => {
      const asMesh = mesh as Mesh;
      if (!asMesh.hasThinInstances) return false;
      const meta = sceneIndex.getMeta(mesh.uniqueId, 0);
      return meta?.type === type;
    }) as Mesh | null) ?? null
  );
}

/**
 * Command to move selected atoms and bonds.
 * Stores original positions for undo support.
 */
export class MoveSelectionCommand extends Command<void> {
  private selectedEntities: SelectedEntity[];
  private delta: Vector3;
  private originalPositions: Map<string, Vector3> = new Map();

  constructor(
    app: MolvisApp,
    args: {
      selectedEntities: SelectedEntity[];
      delta: Vector3;
    },
  ) {
    super(app);
    this.selectedEntities = args.selectedEntities;
    this.delta = args.delta;
  }

  do(): void {
    const scene = this.app.world.scene;

    // Store original positions and move atoms
    for (const entity of this.selectedEntities) {
      if (entity.type !== "atom") continue;

      const mesh = scene.getMeshByUniqueId(entity.meshId) as Mesh;
      const matrices = mesh ? getThinInstanceMatrixBuffer(mesh) : null;
      if (!matrices) continue;
      const offset = entity.instanceIndex * 16;

      // Store original position
      const key = `${entity.meshId}:${entity.instanceIndex}`;
      this.originalPositions.set(
        key,
        new Vector3(
          matrices[offset + 12],
          matrices[offset + 13],
          matrices[offset + 14],
        ),
      );

      // Apply delta
      matrices[offset + 12] += this.delta.x;
      matrices[offset + 13] += this.delta.y;
      matrices[offset + 14] += this.delta.z;

      const pool = this.app.world.sceneIndex.meshRegistry.getPoolForMesh(
        entity.meshId,
      );
      if (pool) pool.uploadBuffer("matrix");
      else mesh.thinInstanceBufferUpdated("matrix");
    }

    // Update connected bonds
    this.updateConnectedBonds();
  }

  undo(): Command {
    const scene = this.app.world.scene;

    // Restore original positions
    for (const entity of this.selectedEntities) {
      if (entity.type !== "atom") continue;

      const mesh = scene.getMeshByUniqueId(entity.meshId) as Mesh;
      const matrices = mesh ? getThinInstanceMatrixBuffer(mesh) : null;
      if (!matrices) continue;

      const key = `${entity.meshId}:${entity.instanceIndex}`;
      const originalPos = this.originalPositions.get(key);
      if (!originalPos) continue;

      const offset = entity.instanceIndex * 16;

      matrices[offset + 12] = originalPos.x;
      matrices[offset + 13] = originalPos.y;
      matrices[offset + 14] = originalPos.z;

      const pool = this.app.world.sceneIndex.meshRegistry.getPoolForMesh(
        entity.meshId,
      );
      if (pool) pool.uploadBuffer("matrix");
      else mesh.thinInstanceBufferUpdated("matrix");
    }

    // Update connected bonds
    this.updateConnectedBonds();

    return this;
  }

  /**
   * Update bond positions based on current atom positions.
   * Bonds are represented as cylinders between two atoms.
   */
  private updateConnectedBonds(): void {
    const scene = this.app.world.scene;

    const atomMesh = findThinInstanceMesh(
      scene,
      this.app.world.sceneIndex,
      "atom",
    );
    if (!atomMesh) return;

    const atomMatrices = getThinInstanceMatrixBuffer(atomMesh);
    if (!atomMatrices) return;

    const bondMeshes = scene.meshes.filter((mesh) => {
      const asMesh = mesh as Mesh;
      if (!asMesh.hasThinInstances) return false;
      const meta = this.app.world.sceneIndex.getMeta(mesh.uniqueId, 0);
      return meta?.type === "bond";
    }) as Mesh[];

    for (const bondMesh of bondMeshes) {
      const matrices = getThinInstanceMatrixBuffer(bondMesh);
      if (!matrices) continue;

      const bondCount = Math.floor(matrices.length / 16);
      for (let bondIdx = 0; bondIdx < bondCount; bondIdx++) {
        const meta = this.app.world.sceneIndex.getMeta(
          bondMesh.uniqueId,
          bondIdx,
        );
        if (meta?.type !== "bond") continue;

        const offset1 = meta.atomId1 * 16;
        const offset2 = meta.atomId2 * 16;
        if (
          offset1 + 14 >= atomMatrices.length ||
          offset2 + 14 >= atomMatrices.length
        ) {
          continue;
        }

        const pos1 = new Vector3(
          atomMatrices[offset1 + 12],
          atomMatrices[offset1 + 13],
          atomMatrices[offset1 + 14],
        );

        const pos2 = new Vector3(
          atomMatrices[offset2 + 12],
          atomMatrices[offset2 + 13],
          atomMatrices[offset2 + 14],
        );

        const bondCenter = Vector3.Center(pos1, pos2);
        const bondVector = pos2.subtract(pos1);
        const bondLength = bondVector.length();

        const bondOffset = bondIdx * 16;

        const up = new Vector3(0, 1, 0);
        const axis = Vector3.Cross(up, bondVector.normalize());
        const angle = Math.acos(Vector3.Dot(up, bondVector.normalize()));

        const rotationMatrix =
          axis.length() > 0.001
            ? Matrix.RotationAxis(axis.normalize(), angle)
            : Matrix.Identity();

        const scaleMatrix = Matrix.Scaling(1, bondLength, 1);
        const translationMatrix = Matrix.Translation(
          bondCenter.x,
          bondCenter.y,
          bondCenter.z,
        );

        const finalMatrix = scaleMatrix
          .multiply(rotationMatrix)
          .multiply(translationMatrix);

        for (let i = 0; i < 16; i++) {
          matrices[bondOffset + i] = finalMatrix.m[i];
        }
      }

      const bondPool = this.app.world.sceneIndex.meshRegistry.getPoolForMesh(
        bondMesh.uniqueId,
      );
      if (bondPool) bondPool.uploadBuffer("matrix");
      else bondMesh.thinInstanceBufferUpdated("matrix");
    }
  }
}

/**
 * Copy the rows at `indices` out of `source` into `target`, column by column.
 *
 * Dispatches on each column's own dtype, so every column the source carries —
 * `charge`, `mol_id`, a force vector, anything — comes along. Row indices that
 * fall outside the block are skipped.
 */
function gatherRows(source: Block, target: Block, indices: number[]): void {
  const nrows = source.nrows();
  const rows = indices.filter(
    (i) => Number.isInteger(i) && i >= 0 && i < nrows,
  );

  for (const rawKey of source.keys()) {
    const key = String(rawKey);
    switch (source.dtype(key)) {
      case "f32":
      case "f64": {
        const column = source.viewColF(key);
        target.setColF(
          key,
          Float64Array.from(rows, (i) => column[i]),
        );
        break;
      }
      case "i32": {
        const column = source.viewColI32(key);
        target.setColI32(
          key,
          Int32Array.from(rows, (i) => column[i]),
        );
        break;
      }
      case "u32": {
        const column = source.viewColU32(key);
        target.setColU32(
          key,
          Uint32Array.from(rows, (i) => column[i]),
        );
        break;
      }
      case "string": {
        const column = source.copyColStr(key) as string[];
        target.setColStr(
          key,
          rows.map((i) => String(column[i])),
        );
        break;
      }
      // Any other dtype has no molrs-wasm accessor pair; leaving the column
      // out is better than inventing values for it.
    }
  }
}

/**
 * Build a Frame holding just the selected atoms and bonds.
 *
 * Canvas selection is WYSIWYG against SceneIndex. When the working tree is
 * dirty, or any selected id is not a dense HEAD row, materialize from the
 * scene (canvas coordinates) and remap logical ids → dense rows. Clean HEAD
 * with in-range ids may use `system.frame` so extra columns are preserved.
 *
 * Bond endpoints are renumbered into the emitted atom subset so the returned
 * Frame stands on its own.
 */
export function getSelectedCommand(app: MolvisApp): { frame: Frame } {
  const selected = new MolrsFrame();
  const sm = app.world.selectionManager;
  const selectedAtomIds = [...sm.getSelectedAtomIds()].sort((a, b) => a - b);
  const selectedBondIds = [...sm.getSelectedBondIds()].sort((a, b) => a - b);
  if (selectedAtomIds.length === 0 && selectedBondIds.length === 0) {
    return { frame: selected };
  }

  const head = app.frame;
  const headAtoms = head?.getBlock("atoms");
  const headN = headAtoms?.nrows() ?? 0;
  const headBonds = head?.getBlock("bonds");
  const headBondN = headBonds?.nrows() ?? 0;
  const dirty = app.world.sceneIndex.hasUnsavedChanges;
  const idsOutOfHead =
    selectedAtomIds.some((id) => id < 0 || id >= headN) ||
    selectedBondIds.some((id) => id < 0 || id >= headBondN);

  // Prefer scene whenever canvas may disagree with HEAD (dirty or edit-only ids).
  const useScene = dirty || !head || headN === 0 || idsOutOfHead;

  let source = head;
  let ownsSource = false;
  let atomRows = selectedAtomIds;
  let bondRows = selectedBondIds;

  if (useScene) {
    const built = materializeFrameFromScene(app.world.sceneIndex, {
      sourceFrame: head ?? undefined,
      markSaved: false,
    });
    source = built.frame;
    ownsSource = true;
    atomRows = selectedAtomIds
      .map((id) => built.atomIdToFrameIndex.get(id))
      .filter((row): row is number => row !== undefined);
    bondRows = selectedBondIds
      .map((id) => built.bondIdToFrameIndex.get(id))
      .filter((row): row is number => row !== undefined);
    // Selected ids with no scene meta: fail loudly rather than export HEAD ghosts.
    if (
      atomRows.length !== selectedAtomIds.length ||
      bondRows.length !== selectedBondIds.length
    ) {
      const missingAtoms = selectedAtomIds.filter(
        (id) => !built.atomIdToFrameIndex.has(id),
      );
      const missingBonds = selectedBondIds.filter(
        (id) => !built.bondIdToFrameIndex.has(id),
      );
      if (ownsSource) source.free?.();
      throw new Error(
        `get_selected: selection refers to entities not on the canvas` +
          (missingAtoms.length ? ` (atoms: ${missingAtoms.join(",")})` : "") +
          (missingBonds.length ? ` (bonds: ${missingBonds.join(",")})` : ""),
      );
    }
  }

  try {
    const sourceAtoms = source?.getBlock("atoms");
    if (sourceAtoms && atomRows.length > 0) {
      const n = sourceAtoms.nrows();
      const validRows = atomRows.filter((i) => i >= 0 && i < n);
      if (validRows.length > 0) {
        gatherRows(sourceAtoms, selected.createBlock("atoms"), validRows);
      }
    }

    const sourceBonds = source?.getBlock("bonds");
    if (sourceBonds && bondRows.length > 0) {
      const keptAtomRows =
        atomRows.length > 0
          ? atomRows.filter((i) => {
              const sa = source?.getBlock("atoms");
              return sa != null && i >= 0 && i < sa.nrows();
            })
          : atomRows;
      // Endpoints index the full source, so a bond is only meaningful when
      // both atoms came along.
      const remap = new Map(keptAtomRows.map((row, i) => [row, i]));
      const sourceI = sourceBonds.viewColU32(keys.ATOMI);
      const sourceJ = sourceBonds.viewColU32(keys.ATOMJ);
      const keptRows =
        sourceI && sourceJ
          ? bondRows.filter(
              (row) =>
                row >= 0 &&
                row < sourceBonds.nrows() &&
                remap.has(sourceI[row]) &&
                remap.has(sourceJ[row]),
            )
          : bondRows;

      if (keptRows.length > 0) {
        const bonds = selected.createBlock("bonds");
        gatherRows(sourceBonds, bonds, keptRows);
        if (sourceI && sourceJ) {
          bonds.setColU32(
            keys.ATOMI,
            Uint32Array.from(
              keptRows,
              (row) => remap.get(sourceI[row]) as number,
            ),
          );
          bonds.setColU32(
            keys.ATOMJ,
            Uint32Array.from(
              keptRows,
              (row) => remap.get(sourceJ[row]) as number,
            ),
          );
        }
      }
    }
  } finally {
    if (ownsSource && source) {
      source.free?.();
    }
  }

  return { frame: selected };
}

/**
 * Command to select atoms by their IDs.
 */
@command("select_atoms")
export class SelectAtomByIdCommand extends Command<void> {
  private atomIds: number[];
  private prevSelection: number[];

  constructor(app: MolvisApp, args: { ids: number[] | number }) {
    super(app);
    this.atomIds = Array.isArray(args.ids) ? args.ids : [args.ids];
    this.prevSelection = [];
  }

  do(): void {
    const sm = this.app.world.selectionManager;
    // Backup current selection (only atoms supported for now in this command)
    this.prevSelection = Array.from(sm.getSelectedAtomIds());

    // Clear and select new
    sm.clearSelection();
    sm.selectAtomsByIds(this.atomIds);
  }

  undo(): Command {
    const sm = this.app.world.selectionManager;
    sm.clearSelection();
    sm.selectAtomsByIds(this.prevSelection);
    return this;
  }
}

// Register the command for RPC access
commands.register("get_selected", getSelectedCommand);
