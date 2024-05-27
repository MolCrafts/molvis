import { Box } from './box';
import { Frame } from './frame';
import World from './world';

class System {

    public frame: Frame;
    public box: Box;

    constructor(world: World) {
        world.system = this;
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