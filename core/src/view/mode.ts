import { AbstractMesh, MeshBuilder } from '@babylonjs/core';
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

    private init_pointer_observers = () => {

        this.world.scene.onPointerPick = this.on_pointer_pick;
        this.world.scene.onPointerMove = this.on_pointer_move;
    }

    private on_pointer_move = () => {
        let pickResult = this.world.scene.pick(this.world.scene.pointerX, this.world.scene.pointerY);

        if (pickResult.hit) {
            const mesh = pickResult.pickedMesh;
            if (mesh) {

                const info = mesh2modelname(mesh.name);
                const name = info.name;
                const model = info.model;
                if (model === "Atom") {
                    const atom = this.world.controller!.system.frame.get_atom_by_name(name.slice(7, -1));
                    if (atom !== undefined) {
                        this.world.gui.update_indicator(`${name}: xyz: ${atom.x.toFixed(2)}, ${atom.y.toFixed(2)}, ${atom.z.toFixed(2)}`);
                    }
                }
                else if (model === "Bond") {
                    const bond = this.world.controller!.system.frame.bonds.find(bond => bond.name === name.slice(7, -1));
                    if (bond !== undefined) {
                        this.world.gui.update_indicator(`${name}(${bond.itom.name} - ${bond.jtom.name}): length: ${bond.length.toFixed(2)}`);
                    }
                }
                else {
                    this.world.gui.update_indicator("");
                }
            }
        }
    }

    protected on_pointer_pick = () => {
        let pickResult = this.world.scene.pick(this.world.scene.pointerX, this.world.scene.pointerY);

        if (pickResult.hit) {
            let mesh = pickResult.pickedMesh;
            if (mesh) {
                mesh.renderOutline = !mesh.renderOutline;
                const info = mesh2modelname(mesh.name);
                if (info.model === "Atom") {
                    this.picked_atoms.add(mesh);
                } else if (info.model === "Bond") {
                    this.picked_bonds.add(mesh);
                }
            }
        } else {
            this.picked_atoms.forEach(atom => atom.renderOutline = false);
            this.picked_bonds.forEach(bond => bond.renderOutline = false);
            this.picked_atoms.clear();
            this.picked_bonds.clear();
        }
    }

}

export class MeasureMode extends ViewMode {

    protected on_pointer_pick = () => {
        let pickResult = this.world.scene.pick(this.world.scene.pointerX, this.world.scene.pointerY);

        if (pickResult.hit) {
            const mesh = pickResult.pickedMesh;
            if (mesh) {
                const info = mesh2modelname(mesh.name);
                const name = info.name;
                const model = info.model;
                mesh.renderOutline = !mesh.renderOutline;
                if (model === "Atom") {
                    this.picked_atoms.add(mesh);
                    console.log(`picked: ${this.picked_atoms.size}`);
                    const lines = MeshBuilder.CreateLines(
                        'measure', {
                        points: Array.from(this.picked_atoms).map(atom => atom.position),
                        updatable: true
                    }, this.world.scene
                    )
                } else if (model === "Bond") {
                    this.picked_bonds.add(mesh);
                }
            } else {
                this.picked_atoms.forEach(atom => atom.renderOutline = false);
                this.picked_bonds.forEach(bond => bond.renderOutline = false);
                this.picked_atoms.clear();
                this.picked_bonds.clear();
            }
        }
    }
}