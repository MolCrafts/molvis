import * as BABYLON from "@babylonjs/core";
import { AdvancedDynamicTexture, TextBlock } from "@babylonjs/gui";
import { makeTextPlane } from "./gui";

class Selector {

    private _scene: BABYLON.Scene;
    private _action_manager: BABYLON.ActionManager;

    public constructor(scene: BABYLON.Scene) {
        this._scene = scene;
        this._action_manager = new BABYLON.ActionManager(scene);
    }

    get action_manager() {
        return this._action_manager;
    }

}

class AtomSelector extends Selector {

    public constructor(scene: BABYLON.Scene) {
        super(scene);
        let n = 0;
        let adt = AdvancedDynamicTexture.CreateFullscreenUI("atomSelectorGUI", undefined, scene, BABYLON.Texture.NEAREST_NEAREST);
        adt.rootContainer.scaleX = window.devicePixelRatio;
        adt.rootContainer.scaleY = window.devicePixelRatio;
        let hoveredGUI = new TextBlock("atomHoveredGUI");
        adt.addControl(hoveredGUI);

        


        this.action_manager.registerAction(new BABYLON.ExecuteCodeAction(BABYLON.ActionManager.OnPickTrigger, (event) => {
            let pickedMesh = event.meshUnderPointer;
            if (!pickedMesh) return;
            let pickedGUI = scene.getMeshByName(pickedMesh.name + "_GUI");
            if (!pickedMesh.renderOutline && !pickedGUI) {
                let pickedGUI = makeTextPlane("", "black", 1, scene);
            }
            else {
                pickedGUI.isVisible = false;
            }
            pickedMesh.renderOutline = !pickedMesh.renderOutline;

        }));
        this.action_manager.registerAction(new BABYLON.ExecuteCodeAction(BABYLON.ActionManager.OnPointerOverTrigger, (event) => {

        }));

    }

    public selectify(atom: BABYLON.Mesh) {
        atom.actionManager = this.action_manager;
    }

    private _update_gui(msg:string) {
        // let gui = new BABYLON.GUI.TextBlock();

    }

}

export { AtomSelector };