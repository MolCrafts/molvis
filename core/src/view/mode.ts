import { AbstractMesh, IPointerEvent, LinesMesh, MeshBuilder, Nullable, PickingInfo } from '@babylonjs/core';
import { World } from './world';
import { mesh2modelname } from './utils';

export class Mode {

    world: World;
    constructor(world: World) {
        this.world = world;
    }

}

export class ViewMode extends Mode {

    protected picked_atoms: Set<AbstractMesh> = new Set();
    protected picked_bonds: Set<AbstractMesh> = new Set();

    constructor(world: World) {
        super(world);
        this.init();
    }
    private init = () => {
        this.init_pointer_observers();
    }

    protected init_pointer_observers = () => {

        this.world.scene.onPointerPick = this.on_pointer_pick;
        this.world.scene.onPointerMove = this.on_pointer_move;
    }

    private on_pointer_move = () => {
        let pickinfo = this.world.scene.pick(this.world.scene.pointerX, this.world.scene.pointerY);

        if (pickinfo.hit) {
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

    protected on_pointer_pick = (evt: IPointerEvent, pickinfo: PickingInfo) => {
        
        if (pickinfo.hit) {
            let mesh = pickinfo.pickedMesh;
            if (mesh) {
                mesh.renderOutline = !mesh.renderOutline;
                const info = mesh2modelname(mesh.name);
                if (info.model === "Atom") {
                    this.picked_atoms.add(mesh);
                } else if (info.model === "Bond") {
                    this.picked_bonds.add(mesh);
                }
            }
        }
    }

}

export class MeasureMode extends ViewMode {

    private lines: LinesMesh | undefined = undefined;

    constructor(world: World) {
        super(world);
        this.init_pointer_observers();
    }

    protected override on_pointer_pick = (evt: IPointerEvent, pickinfo: PickingInfo) => {
        console.log(pickinfo);
        if (pickinfo.hit) {
            const mesh = pickinfo.pickedMesh;
            if (mesh) {
                const info = mesh2modelname(mesh.name);
                const name = info.name;
                const model = info.model;
                mesh.renderOutline = !mesh.renderOutline;
                if (model === "Atom") {
                    this.picked_atoms.add(mesh);
                } else if (model === "Bond") {
                    this.picked_bonds.add(mesh);
                }
            } 

            if (this.picked_atoms.size > 1) {
                const options = {
                    points: Array.from(this.picked_atoms).map(atom => atom.position),
                    updatable: true
                }
                this.lines = MeshBuilder.CreateLines("lines", options, this.world.scene);
            }
        }
    }
}