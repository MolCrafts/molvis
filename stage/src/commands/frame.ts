import type { Frame } from "@molcrafts/molvis-core/molrs";
import type { MolvisApp } from "../app";
import { materializeFrameFromScene } from "../scene_sync";
import { Command, command } from "./base";

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
 * Export the current staged scene as a Frame.
 *
 * Returns the frame itself rather than a hand-copied subset of it. The old
 * implementation emitted a fixed `{x, y, z, element}` / `{atomi, atomj, order}`
 * whitelist, so a `charge`, `mol_id`, force or grid column the caller had put
 * in was silently dropped on the way back out.
 *
 * Ownership passes to the caller, which must `free()` the frame once it has
 * serialized it.
 */
@command("export_frame")
export class ExportFrameCommand extends Command<{
  frame: Frame;
  atomIds: number[];
}> {
  do(): { frame: Frame; atomIds: number[] } {
    const exported = materializeFrameFromScene(this.app.world.sceneIndex, {
      markSaved: false,
      sourceFrame: this.app.frame ?? undefined,
    });
    return {
      frame: exported.frame,
      // Dense export row → stable scene id, from the same materialization.
      // Hosts can reconcile edits without assuming scene ids equal row ids.
      atomIds: [...exported.atomIdToFrameIndex.keys()],
    };
  }

  undo(): Command {
    return this;
  }
}
