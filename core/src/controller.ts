import World from "./world";
import System from "./system";

interface Operation {
    target: string;
    method: string;
    kwargs: object;
}

class Controller {

    protected world: World;
    public system: System;

    [key: string]: any;

    constructor(world: World, system: System) {
        this.world = world;
        this.system = system;
    }

    public do(target: string, method: string, kwargs: object) {
        let tar = this;
        for (let t of target.split(".")) {
            tar = tar[t];
        }

        if (kwargs) { console.log('with kwargs'); tar[method](...Object.values(kwargs)); }
        else { console.log('w/o kwargs'); tar[method](); }
    }

}

export default Controller;