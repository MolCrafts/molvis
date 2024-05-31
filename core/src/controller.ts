import {World} from "./view/world";
import {System} from "./model/system";
import { IJsonPRCRequest } from "./rpc/protocol";

export class Controller {

    public world: World;
    public system: System;

    [key: string]: any;

    constructor(world: World, system: System) {
        this.world = world;
        this.system = system;
        this.world.set_controller(this);
    }

    public set_orthogonal_box = (lengths: number[], origin: number[], direction: number[]) => {
        const region = this.system.region.set_orthogonal_box(lengths, origin, direction);
        this.world.draw(region);
    }

    public add_atom = (name: string, { x, y, z }: { x: number, y: number, z: number }) => {
        const atom = this.system.frame.add_atom(name, { x, y, z });
        this.world.draw(atom);
    }

}
