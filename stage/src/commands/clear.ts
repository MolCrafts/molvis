import type { AbstractMesh } from "@babylonjs/core";
import { Command, command } from "./base";

/**
 * Command to clear all rendering meshes from the scene
 */
@command("clear_scene")
export class ClearSceneCommand extends Command<void> {
  do(): void {
    const registry = this.app.world.sceneIndex.meshRegistry;
    const meshesToDispose: AbstractMesh[] = [];

    const atomState = registry.getAtomState();
    if (atomState) meshesToDispose.push(atomState.mesh);

    const bondState = registry.getBondState();
    if (bondState) meshesToDispose.push(bondState.mesh);

    // Also clear sim_box meshes
    const scene = this.app.world.scene;
    for (const mesh of scene.meshes) {
      if (mesh.name === "sim_box") {
        meshesToDispose.push(mesh);
      }
    }

    for (const m of meshesToDispose) {
      this.app.world.sceneIndex.unregister(m.uniqueId);
      m.dispose();
    }
  }

  undo(): Command {
    // Cannot undo a clear operation easily
    // Would need to store all mesh data and recreate
    return this;
  }
}
