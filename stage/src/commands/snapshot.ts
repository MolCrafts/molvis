import { Tools } from "@babylonjs/core";
import type { MolvisApp } from "../app";
import { Command, command } from "./base";

/**
 * Command to take a snapshot of the current view.
 */
@command("take_snapshot")
export class TakeSnapshotCommand extends Command<{ data: string }> {
  constructor(app: MolvisApp, _args: unknown) {
    super(app);
  }

  async do(): Promise<{ data: string }> {
    return new Promise((resolve, reject) => {
      try {
        const scene = this.app.world.scene;
        const camera = scene.activeCamera;
        if (!camera) {
          reject(new Error("No active camera"));
          return;
        }
        Tools.CreateScreenshot(
          scene.getEngine(),
          camera,
          {
            width: scene.getEngine().getRenderWidth(),
            height: scene.getEngine().getRenderHeight(),
          },
          (data) => {
            // data is a base64 string
            resolve({ data });
          },
        );
      } catch (e) {
        reject(e);
      }
    });
  }

  undo(): Command {
    return this;
  }
}
