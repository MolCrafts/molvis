import * as BABYLON from "@babylonjs/core";
import Molvis from "./app";

class Selector {

    private _atom_selector: AtomSelector;
    private molvis: Molvis;

    public constructor(molvis: Molvis) {
        this.molvis = molvis;
        this._atom_selector = new AtomSelector();
        this.molvis.scene.onPointerDown = (event, pickInfo) => {
            if (pickInfo.hit && pickInfo.pickedMesh) {
                let mesh = pickInfo.pickedMesh;
                if (mesh.name.startsWith("atom")) {
                    this._atom_selector.select(mesh);
                }
            }
        }
    }

    public select_atom(index: number) {
        let atom = this.molvis.system.atoms[index];
        // console.log(atom);
        let id = atom.props.id;
        let mesh = this.molvis.scene.getMeshByUniqueID(id);
        if (!mesh) throw new Error("atom not found");
        this._atom_selector.select(mesh);
        let com = this.molvis.com;
        this.molvis.com.send_message("select atom " + index);
    }

}

class AtomSelector {

    private _selected_atoms: {[key:string]: BABYLON.AbstractMesh} = {};

    public select(atom: BABYLON.AbstractMesh) {
        if (atom.id in this._selected_atoms) {
            delete this._selected_atoms[atom.id] 
            atom.renderOutline = false;
        }
        else {
            this._selected_atoms[atom.id] = atom;
            atom.renderOutline = true;
        }
        
    }

}

export { Selector };

// // class AtomSelector extends Selector {

//     public constructor(scene: BABYLON.Scene) {
//         super(scene);
//         let n = 0;
//         let adt = AdvancedDynamicTexture.CreateFullscreenUI("atomSelectorGUI", undefined, scene, BABYLON.Texture.NEAREST_NEAREST);
//         adt.rootContainer.scaleX = window.devicePixelRatio;
//         adt.rootContainer.scaleY = window.devicePixelRatio;
//         let hoveredGUI = new TextBlock("atomHoveredGUI");
//         adt.addControl(hoveredGUI);

//         this.action_manager.registerAction(new BABYLON.ExecuteCodeAction(BABYLON.ActionManager.OnPickTrigger, (event) => {
//             let pickedMesh = event.meshUnderPointer;
//             if (!pickedMesh) return;
//             let pickedGUI = scene.getMeshByName(pickedMesh.name + "_GUI");
//             if (!pickedMesh.renderOutline && !pickedGUI) {
//                 let pickedGUI = makeTextPlane("", "black", 1, scene);
//             }
//             else {
//                 pickedGUI.isVisible = false;
//             }
//             pickedMesh.renderOutline = !pickedMesh.renderOutline;

//         }));
//         this.action_manager.registerAction(new BABYLON.ExecuteCodeAction(BABYLON.ActionManager.OnPointerOverTrigger, (event) => {

//         }));

//     }

//     public selectify(atom: BABYLON.Mesh) {
//         atom.actionManager = this.action_manager;
//     }

//     private _update_gui(msg:string) {
//         // let gui = new BABYLON.GUI.TextBlock();

//     }

// }

// export { AtomSelector };