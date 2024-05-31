import { World } from './world';

class Mode {

    world: World;
    constructor(world: World) {
        this.world = world;
    }

}

class ViewMode extends Mode {
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
            const name = mesh!.name;
            const atom = this.world.controller!.system.frame.get_atom_by_name(name);
            if (atom !== undefined) {
                this.world.gui.update_indicator(`Atom: ${atom.name} xyz: ${atom.x.toFixed(2)}, ${atom.y.toFixed(2)}, ${atom.z.toFixed(2)}`);
            }
            else {
                throw new Error(`No atom found with name ${name}`);
            }
        }
        else {
            this.world.gui.update_indicator("");
        }
    }

    private on_pointer_pick = () => {
        let pickResult = this.world.scene.pick(this.world.scene.pointerX, this.world.scene.pointerY);

        if (pickResult.hit) {
            let mesh = pickResult.pickedMesh;
            if (mesh!.renderOutline) {
                mesh!.renderOutline = false;
            } else
                mesh!.renderOutline = true
        }
    }

}

export { Mode, ViewMode };