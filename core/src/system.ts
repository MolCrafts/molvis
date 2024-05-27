import { Box } from './box';
import { Frame } from './frame';
import World from './world';

class System {

    public frame: Frame;
    public box: Box;

    constructor(world: World) {
        this.frame = new Frame(world);
        this.box = new Box(world);
        return new Proxy(this, {
            get: (target, key:string) => {
                if (typeof target[key] === 'function') {
                    return target[key].bind(target);
                } else {
                    return target[key];
                }
            }
        })
    }

    public draw() {
        this.box.draw();
        this.frame.draw();
    }

    public update() {}

}

export default System;