import * as BABYLON from "@babylonjs/core";
import Molvis from "./app";
import { PickSelector } from "./pick/selector";
import { AtomBrush } from "./drawing/atom";
import { pick_screen_with_depth } from "./pick/utils";

class Mode { }

class Edit extends Mode {

    molvis: Molvis;
    atom_brush: AtomBrush;

    constructor(molvis: Molvis) {
        super();
        this.molvis = molvis;
        this.atom_brush = new AtomBrush(molvis);
        this.register_pointer_observer();

        // this.register_keyboard_observer();
    }

    private register_pointer_observer() {

        const scene = this.molvis.scene;
        const camera = this.molvis.main_camera;

        const selector = new PickSelector(this.molvis);
        let selected: BABYLON.Nullable<BABYLON.AbstractMesh> = null;
        let pointer_down_position: BABYLON.Nullable<BABYLON.Vector3> = null;
        let is_down = false;
        let is_move = false;
        let is_up = false;
        scene.onPointerObservable.add((pointerInfo) => {
            if (pointerInfo.event.button == 0) {
                switch (pointerInfo.type) {
                    case BABYLON.PointerEventTypes.POINTERDOWN:
                        is_up = false;
                        selected = selector.select();
                        if (selected) {
                            pointer_down_position = selected.position;
                            camera.detachControl();

                            var pointerDragBehavior = new BABYLON.PointerDragBehavior({ });
                            // Use drag plane in world space
                            pointerDragBehavior.useObjectOrientationForDragging = false;
                            pointerDragBehavior.onDragStartObservable.add((event) => {
                                const clonedNode = pointerDragBehavior.attachedNode.clone();
                                clonedNode.actionManager = actionManager
                                // clonedNode.addBehavior(pointerDragBehavior)
                                // console.log(event);
                            })
                        
                            var actionManager = new BABYLON.ActionManager(scene);
                            actionManager.registerAction(
                                new BABYLON.ExecuteCodeAction(BABYLON.ActionManager.OnPickDownTrigger, (event) => {
                                    event.meshUnderPointer.removeBehavior(pointerDragBehavior)
                                    event.meshUnderPointer.addBehavior(pointerDragBehavior);
                                }));
                        
                                selected.actionManager = actionManager

                        }
                        else {
                            pointer_down_position = pick_screen_with_depth(scene, 10);
                            let atom = this.atom_brush.draw("atom", pointer_down_position);
                        }


                        break;
                    case BABYLON.PointerEventTypes.POINTERMOVE:
                    
                        break;
                    case BABYLON.PointerEventTypes.POINTERUP:
                        if (selected && !is_move) {
                            selected.renderOutline = !selected.renderOutline;
                        }
                        is_down = false;
                        is_move = false;
                        is_up = true;
                        camera.attachControl();
                        break;
                }
            }
        });

    }
}

export { Mode, Edit };