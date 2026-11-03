import { Color3, Vector3 } from "@babylonjs/core";
import type { MolvisApp } from "../app";
import type { DrawAtomOptions, DrawBondOptions } from "../artist";
import { Command } from "./base";

/**
 * No-op command. Reused by Edit-mode commands below as their undo target
 * when no actual reverse work is needed.
 */
class NoOpCommand extends Command<void> {
  do(): void {}
  undo(): Command {
    return this;
  }
}

// DrawAtomOptions and DrawBondOptions are defined in artist.ts
export type { DrawAtomOptions, DrawBondOptions } from "../artist";

/**
 * Command to draw an atom in Edit mode.
 */
export class DrawAtomCommand extends Command<{ atomId: number }> {
  private atomId: number;
  private executed = false;
  private meshId = 0;

  constructor(
    app: MolvisApp,
    private position: Vector3,
    private options: DrawAtomOptions,
  ) {
    super(app);
    this.atomId =
      options.atomId ?? (app.world.sceneIndex.getNextAtomId?.() || 0);
  }

  async do(): Promise<{ atomId: number }> {
    const result = await this.app.artist.drawAtom(this.position, {
      ...this.options,
      atomId: this.atomId,
    });
    this.atomId = result.atomId;
    this.meshId = result.meshId;
    this.executed = true;
    return { atomId: this.atomId };
  }

  undo(): Command {
    if (!this.executed) {
      throw new Error("Cannot undo DrawAtomCommand: not executed");
    }
    if (this.meshId) {
      this.app.artist.deleteAtom(this.meshId, this.atomId);
    }
    this.executed = false;
    return new NoOpCommand(this.app);
  }
}

/** Change an atom's element in place, preserving its id and topology. */
export class SetAtomElementCommand extends Command<void> {
  private previousElement: string | null = null;

  constructor(
    app: MolvisApp,
    private atomId: number,
    private element: string,
  ) {
    super(app);
  }

  do(): void {
    const meta = this.app.world.sceneIndex.metaRegistry.atoms.getMeta(
      this.atomId,
    );
    if (!meta) return;
    if (this.previousElement === null) this.previousElement = meta.element;
    this.apply(this.element);
  }

  undo(): Command {
    if (this.previousElement !== null) this.apply(this.previousElement);
    return new NoOpCommand(this.app);
  }

  private apply(element: string): void {
    const index = this.app.world.sceneIndex;
    const meta = index.metaRegistry.atoms.getMeta(this.atomId);
    const state = index.meshRegistry.getAtomState();
    if (!meta || !state) return;

    const style = this.app.styleManager.getAtomStyle(element);
    const radius = style.radius;
    const scale = radius * 2;
    const color = Color3.FromHexString(style.color).toLinearSpace();
    const p = meta.position;
    const matrix = new Float32Array(16);
    matrix[0] = scale;
    matrix[5] = scale;
    matrix[10] = scale;
    matrix[15] = 1;
    matrix[12] = p.x;
    matrix[13] = p.y;
    matrix[14] = p.z;

    index.updateAtom(
      state.mesh.uniqueId,
      this.atomId,
      { element },
      new Map([
        ["matrix", matrix],
        ["instanceData", new Float32Array([p.x, p.y, p.z, radius])],
        [
          "instanceColor",
          new Float32Array([color.r, color.g, color.b, style.alpha ?? 1]),
        ],
      ]),
    );
    this.app.artist.applySceneIndexToMeshes();
  }
}

/** Change a bond's molrs type/number without creating a duplicate bond. */
export class SetBondOrderCommand extends Command<void> {
  private previous: { bondType: number; bondNumber: number } | null = null;

  constructor(
    app: MolvisApp,
    private bondId: number,
    /** Edit-UI Lewis order 1|2|3 → bond_type = bond_number. */
    private order: number,
  ) {
    super(app);
  }

  async do(): Promise<void> {
    const meta = this.app.world.sceneIndex.metaRegistry.bonds.getMeta(
      this.bondId,
    );
    if (!meta) return;
    if (this.previous === null) {
      this.previous = {
        bondType: meta.bondType,
        bondNumber: meta.bondNumber,
      };
    }
    await this.replace({ bondType: this.order, bondNumber: this.order });
  }

  async undo(): Promise<Command> {
    if (this.previous === null) return new NoOpCommand(this.app);
    await this.replace(this.previous);
    return new NoOpCommand(this.app);
  }

  private async replace(cols: {
    bondType: number;
    bondNumber: number;
  }): Promise<void> {
    const index = this.app.world.sceneIndex;
    const meta = index.metaRegistry.bonds.getMeta(this.bondId);
    const state = index.meshRegistry.getBondState();
    if (!meta || !state) return;
    const start = new Vector3(meta.start.x, meta.start.y, meta.start.z);
    const end = new Vector3(meta.end.x, meta.end.y, meta.end.z);
    this.app.artist.deleteBond(state.mesh.uniqueId, this.bondId);
    await this.app.artist.drawBond(start, end, {
      bondId: this.bondId,
      atomId1: meta.atomId1,
      atomId2: meta.atomId2,
      bondType: cols.bondType,
      bondNumber: cols.bondNumber,
    });
  }
}

/**
 * Command to delete an atom and connected bonds.
 * Operates on the edit pool.
 */
export class DeleteAtomCommand extends Command<void> {
  private savedAtomData: Record<string, Float32Array> | null = null;
  private savedAtomMeta: {
    element: string;
    position: { x: number; y: number; z: number };
  } | null = null;
  private deletedBonds: Array<{
    bondId: number;
    data: Record<string, Float32Array>;
    meta: {
      atomId1: number;
      atomId2: number;
      bondType: number;
      bondNumber: number;
      start: { x: number; y: number; z: number };
      end: { x: number; y: number; z: number };
    } | null;
  }> = [];

  constructor(
    app: MolvisApp,
    private atomId: number,
  ) {
    super(app);
  }

  do(): void {
    const atomState = this.app.world.sceneIndex.meshRegistry.getAtomState();
    if (!atomState) return;

    const bondState = this.app.world.sceneIndex.meshRegistry.getBondState();

    // Save atom buffers
    this.savedAtomData = {};
    for (const bufName of [
      "matrix",
      "instanceData",
      "instanceColor",
      "instanceStyle",
      "instancePickingColor",
    ]) {
      const data = atomState.read(this.atomId, bufName);
      if (data) this.savedAtomData[bufName] = new Float32Array(data);
    }

    // Save atom metadata
    const meta = this.app.world.sceneIndex.metaRegistry.atoms.getMeta(
      this.atomId,
    );
    if (meta) {
      this.savedAtomMeta = {
        element: meta.element,
        position: { ...meta.position },
      };
    }

    // Save and remove connected bonds
    const connectedBonds = this.app.world.sceneIndex.topology.getBondsForAtom(
      this.atomId,
    );
    this.deletedBonds = [];

    for (const bondId of connectedBonds) {
      if (bondState) {
        const bondData: Record<string, Float32Array> = {};
        for (const bufName of [
          "matrix",
          "instanceData0",
          "instanceData1",
          "instanceColor0",
          "instanceColor1",
          "instanceSplit",
          "instancePickingColor",
        ]) {
          const data = bondState.readAll(bondId, bufName);
          if (data) bondData[bufName] = new Float32Array(data);
        }
        const bondMeta =
          this.app.world.sceneIndex.metaRegistry.bonds.getMeta(bondId);
        this.deletedBonds.push({
          bondId,
          data: bondData,
          meta: bondMeta
            ? {
                atomId1: bondMeta.atomId1,
                atomId2: bondMeta.atomId2,
                bondType: bondMeta.bondType,
                bondNumber: bondMeta.bondNumber,
                start: { ...bondMeta.start },
                end: { ...bondMeta.end },
              }
            : null,
        });
        this.app.artist.deleteBond(bondState.mesh.uniqueId, bondId);
      }
    }

    this.app.artist.deleteAtom(atomState.mesh.uniqueId, this.atomId);
  }

  async undo(): Promise<Command> {
    if (!this.savedAtomData || !this.savedAtomMeta)
      return new NoOpCommand(this.app);

    // Restore atom
    const buffers = new Map<string, Float32Array>();
    for (const [name, data] of Object.entries(this.savedAtomData)) {
      buffers.set(name, data);
    }
    await this.app.artist.drawAtomFromBuffers(
      {
        atomId: this.atomId,
        element: this.savedAtomMeta.element,
        position: this.savedAtomMeta.position,
      },
      buffers,
    );

    // Restore bonds
    for (const { bondId, data, meta } of this.deletedBonds) {
      if (!meta) continue;
      const bondBuffers = new Map<string, Float32Array>();
      for (const [name, buf] of Object.entries(data)) {
        bondBuffers.set(name, buf);
      }
      await this.app.artist.drawBondFromBuffers(
        {
          bondId,
          atomId1: meta.atomId1,
          atomId2: meta.atomId2,
          bondType: meta.bondType,
          bondNumber: meta.bondNumber,
          start: meta.start,
          end: meta.end,
        },
        bondBuffers,
      );
    }

    return new NoOpCommand(this.app);
  }
}

/**
 * Command to draw a bond in Edit mode.
 */
export class DrawBondCommand extends Command<{ bondId: number }> {
  private bondId: number;
  private executed = false;
  private meshId = 0;

  constructor(
    app: MolvisApp,
    private startPos: Vector3,
    private endPos: Vector3,
    private options: DrawBondOptions,
  ) {
    super(app);
    this.bondId =
      options.bondId ?? (app.world.sceneIndex.getNextBondId?.() || 0);
  }

  async do(): Promise<{ bondId: number }> {
    const result = await this.app.artist.drawBond(this.startPos, this.endPos, {
      ...this.options,
      bondId: this.bondId,
    });
    this.bondId = result.bondId;
    this.meshId = result.meshId;
    this.executed = true;
    return { bondId: this.bondId };
  }

  undo(): Command {
    if (!this.executed) {
      throw new Error("Cannot undo DrawBondCommand: not executed");
    }
    if (this.meshId) {
      this.app.artist.deleteBond(this.meshId, this.bondId);
    }
    this.executed = false;
    return new NoOpCommand(this.app);
  }
}

/**
 * Command to delete an edit-mode bond.
 */
export class DeleteBondCommand extends Command<void> {
  private savedData: Record<string, Float32Array> | null = null;
  private savedMeta: {
    atomId1: number;
    atomId2: number;
    bondType: number;
    bondNumber: number;
    start: { x: number; y: number; z: number };
    end: { x: number; y: number; z: number };
  } | null = null;

  constructor(
    app: MolvisApp,
    private bondId: number,
  ) {
    super(app);
  }

  do(): void {
    const bondState = this.app.world.sceneIndex.meshRegistry.getBondState();
    if (!bondState) return;

    // Save bond buffers and metadata before deletion
    this.savedData = {};
    for (const bufName of [
      "matrix",
      "instanceData0",
      "instanceData1",
      "instanceColor0",
      "instanceColor1",
      "instanceSplit",
      "instancePickingColor",
    ]) {
      // readAll captures every sub-instance for multi-order bonds.
      const data = bondState.readAll(this.bondId, bufName);
      if (data) this.savedData[bufName] = new Float32Array(data);
    }
    const meta = this.app.world.sceneIndex.metaRegistry.bonds.getMeta(
      this.bondId,
    );
    if (meta) {
      this.savedMeta = {
        atomId1: meta.atomId1,
        atomId2: meta.atomId2,
        bondType: meta.bondType,
        bondNumber: meta.bondNumber,
        start: { ...meta.start },
        end: { ...meta.end },
      };
    }

    this.app.artist.deleteBond(bondState.mesh.uniqueId, this.bondId);
  }

  async undo(): Promise<Command> {
    if (!this.savedData || !this.savedMeta) return new NoOpCommand(this.app);

    const buffers = new Map<string, Float32Array>();
    for (const [name, data] of Object.entries(this.savedData)) {
      buffers.set(name, data);
    }
    await this.app.artist.drawBondFromBuffers(
      { bondId: this.bondId, ...this.savedMeta },
      buffers,
    );
    return new NoOpCommand(this.app);
  }
}
