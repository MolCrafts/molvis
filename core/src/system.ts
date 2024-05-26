import { Box } from './box';
import { Frame } from './frame';
import World from './world';

class System {

    private world: World;
    public frame: Frame;
    public box: Box;

    constructor(world: World) {
        this.world = world;
        this.frame = new Frame(world);
        this.box = new Box(world);
    }

    public draw() {
        this.box.draw();
        this.frame.draw();
    }

    public update() {}

}

export default System;