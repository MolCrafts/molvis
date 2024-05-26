import { Box } from './box';
import { Frame } from './frame';
import World from './world';

class System {

    public frame: Frame;
    public box: Box;

    [key: string]: any;

    constructor(world: World) {
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