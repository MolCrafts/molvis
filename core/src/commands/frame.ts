import { Frame } from "@molcrafts/molrs";
import type { MolvisApp } from "../app";
import { viewAtomCoords } from "../io/atom_coords";
import { syncSceneToFrame } from "../scene_sync";
import { DType } from "../utils/dtype";
import { Command, command } from "./base";

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
    const tempFrame = new Frame();
    syncSceneToFrame(this.app.world.sceneIndex, tempFrame, {
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
