import World from './world';

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
            let mesh = pickResult.pickedMesh;
            console.log(mesh!.name);
        }
    }

    private on_pointer_pick = () => {
        let pickResult = this.world.scene.pick(this.world.scene.pointerX, this.world.scene.pointerY);

        if (pickResult.hit) {
            let mesh = pickResult.pickedMesh;
            console.log(mesh!.name);
            // highlight
            if (mesh!.renderOutline) {
                mesh!.renderOutline = false;
            } else
                mesh!.renderOutline = true
        }
    }

}

export { Mode, ViewMode };