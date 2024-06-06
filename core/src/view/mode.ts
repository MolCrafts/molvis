import { AbstractMesh, IPointerEvent, LinesMesh, MeshBuilder, Nullable, PickingInfo, PointerInfo } from '@babylonjs/core';
import { PointerEventTypes } from '@babylonjs/core';
import { World } from './world';
import { mesh2modelname } from './utils';

export interface IMode {

}

abstract class Mode implements IMode {

    protected world: World;

    constructor(world: World) {
        this.world = world;
        this.setup();
        this.init_pointer_observers();
    }

    protected setup = () => { };
    protected abstract on_pointer_move: (pointer_info: PointerInfo) => void;
    protected abstract on_pointer_pick: (pointer_info: PointerInfo) => void;

    protected init_pointer_observers = () => {
        this.world.scene.onPointerObservable.add(
            (pointer_info) => {
                switch (pointer_info.type) {
                    case PointerEventTypes.POINTERDOWN:
                        break;
                    case PointerEventTypes.POINTERUP:
                        break;
                    case PointerEventTypes.POINTERMOVE:
                        this.on_pointer_move(pointer_info);
                        break;
                    case PointerEventTypes.POINTERWHEEL:
                        break;
                    case PointerEventTypes.POINTERPICK:
                        this.on_pointer_pick(pointer_info);
                        break;
                    case PointerEventTypes.POINTERTAP:
                        break;
                    case PointerEventTypes.POINTERDOUBLETAP:
                        break;
                }
            }
        );
    }

}

export class ViewMode extends Mode {

    protected picked_atoms: Set<AbstractMesh> = new Set();
    protected picked_bonds: Set<AbstractMesh> = new Set();

    protected override setup = () => {
        // https://forum.babylonjs.com/t/pickinginfo-hit-never-detects-hits-when-the-pointer-is-moving/42305/4
        this.world.scene.constantlyUpdateMeshUnderPointer = true;
    }

    protected override on_pointer_move = (pointer_info: PointerInfo) => {
        const pickinfo = pointer_info.pickInfo;
        if (pickinfo && pickinfo.hit) {
            const mesh = pickinfo.pickedMesh;
            if (mesh) {

                const info = mesh2modelname(mesh.name);
                const name = info.name;
                const model = info.model;
                if (model === "Atom") {
                    const atom = this.world.controller!.system.frame.get_atom_by_name(name);
                    if (atom !== undefined) {
                        this.world.gui.update_indicator(`Atom: ${name}: xyz: ${atom.x.toFixed(2)}, ${atom.y.toFixed(2)}, ${atom.z.toFixed(2)}`);
                    }
                }
                else if (model === "Bond") {
                    const bond = this.world.controller!.system.frame.bonds.find(bond => bond.name === name);
                    if (bond !== undefined) {
                        this.world.gui.update_indicator(`Bond: ${name}(${bond.itom.name} - ${bond.jtom.name}): length: ${bond.length.toFixed(2)}`);
                    }
                }
                else {
                    this.world.gui.update_indicator("");
                }
            }
        }
    }

    protected override on_pointer_pick = (pointer_info: PointerInfo) => {
        const pickinfo = pointer_info.pickInfo;
        console.log(pickinfo);
        if (pickinfo && pickinfo.hit) {
            const mesh = pickinfo.pickedMesh;
            if (mesh) {
                mesh.renderOutline = !mesh.renderOutline;
                const info = mesh2modelname(mesh.name);
                if (info.model === "Atom") {
                    if (info.model in this.picked_atoms) {
                        this.picked_atoms.delete(mesh);
                    } else {
                        this.picked_atoms.add(mesh);
                    }
                } else if (info.model === "Bond") {
                    if (info.model in this.picked_bonds) {
                        this.picked_bonds.delete(mesh);
                    }
                    else {
                        this.picked_bonds.add(mesh);
                    }
                }
            }
        }
    }

}

// export class MeasureMode extends ViewMode {

//     private lines: LinesMesh | undefined = undefined;

//     constructor(world: World) {
//         super(world);
//         this.init_pointer_observers();
//     }

//     protected override on_pointer_pick = (evt: IPointerEvent, pickinfo: PickingInfo) => {
//         console.log(pickinfo);
//         if (pickinfo.hit) {
//             const mesh = pickinfo.pickedMesh;
//             if (mesh) {
//                 const info = mesh2modelname(mesh.name);
//                 const name = info.name;
//                 const model = info.model;
//                 mesh.renderOutline = !mesh.renderOutline;
//                 if (model === "Atom") {
//                     this.picked_atoms.add(mesh);
//                 } else if (model === "Bond") {
//                     this.picked_bonds.add(mesh);
//                 }
//             }

//             if (this.picked_atoms.size > 1) {
//                 const options = {
//                     points: Array.from(this.picked_atoms).map(atom => atom.position),
//                     updatable: true
//                 }
//                 this.lines = MeshBuilder.CreateLines("lines", options, this.world.scene);
//             }
//         }
//     }
// }