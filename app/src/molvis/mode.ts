import * as BABYLON from "@babylonjs/core";
import Molvis from "./app";
import { PickSelector } from "./modifier/selector";
import { AtomBrush } from "./drawing/atom";

class Mode { }

class Edit extends Mode {

    molvis: Molvis;

    constructor(molvis: Molvis) {
        super();
        this.molvis = molvis;
        this.register_pointer_observer();
        // this.register_keyboard_observer();
    }

    private register_pointer_observer() {

        const scene = this.molvis.scene;
        const camera = this.molvis.main_camera;

        let pointer_down_position: BABYLON.Vector3 | null = null;
        let to_draw_atom: BABYLON.Mesh | null = null;
        let selector = new PickSelector(this.molvis);

        this.molvis.scene.onPointerObservable.add((pointerInfo) => {
            switch (pointerInfo.event.button) {
                case 0:  // left button
                    // click: pointer_down and pointer_up
                    // drag: pointer_down and pointer_move and pointer_up

                    // left button:
                    // click on mesh: select and outline
                    // click on space: draw an atom
                    // drag on mesh: draw an atom and bond
                    // drag on space: rotate camera
                    switch (pointerInfo.type) {
                        case BABYLON.PointerEventTypes.POINTERDOWN:
                            const is_select = selector.select();
                            if (is_select) {
                                camera.detachControl();
                                // TODO: many atoms are selected then drag-move
                                if (selector.n_selected == 1) {
                                    pointer_down_position = selector.selected[0].position;
                                }
                            } else {
                                // wait for draw atom when pointer up
                            }
                        case BABYLON.PointerEventTypes.POINTERMOVE:
                            if (pointer_down_position === null) {
                                // drag on space
                                camera.attachControl();
                            } else {
                                // drag on mesh: draw an atom and [bond]
                                if (!to_draw_atom) {
                                    to_draw_atom = BABYLON.MeshBuilder.CreateSphere("to_draw_atom", { diameter: 1 }, scene);
                                    to_draw_atom.position = pointer_down_position;
                                }
                                const origin = camera.position;
                                const normal = camera.target.subtract(camera.position);
                                const plane = BABYLON.Plane.FromPositionAndNormal(origin, normal);
                                // find xyz on the plane
                                const x = scene.pointerX;
                                const y = scene.pointerY;
                                const ray = scene.createPickingRay(x, y, BABYLON.Matrix.Identity(), camera);
                                // find the intersection of the ray and the plane
                                const intersection = ray.intersectsPlane(plane);
                                if (intersection) {
                                    const xyz = ray.origin.add(ray.direction.scale(intersection));
                                    to_draw_atom.position = xyz;
                                }

                            }
                        case BABYLON.PointerEventTypes.POINTERUP:

                            if (to_draw_atom) {
                                // drag on mesh, concrete the atom
                                to_draw_atom.dispose();
                                to_draw_atom = null;
                            } else {
                                // drag on space, do nothing
                                if (selector.n_selected == 1) {
                                    // click on mesh, outline
                                    selector.modify();
                                    selector.reset();
                                } else if (selector.n_selected == 0) {
                                    // click on space, draw an atom
                                    const atombrush = new AtomBrush(this.molvis);
                                    atombrush.draw_on_pointer();
                                }
                            }

                    }
            }
        });

    }
}


export { Mode, Edit };