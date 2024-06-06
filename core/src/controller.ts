import { World } from "./view/world";
import { ISystem, FrameSystem, TrajSystem } from "./model/system";
import { IJsonPRCRequest } from "./rpc/protocol";
import { Frame } from "./model/frame";

export class Controller {

    public world: World;
    public system: FrameSystem | TrajSystem;

    [key: string]: any;

    constructor(world: World) {
        this.world = world;
        this.system = new FrameSystem();
        this.world.set_controller(this);
    }

    // public set_orthogonal_box = (lengths: number[], origin: number[], direction: number[]) => {
    //     const region = this.system.region.set_orthogonal_box(lengths, origin, direction);
    //     this.world.draw(region);
    // }

    public add_atom = (name: string, x: number, y: number, z: number, props = {}) => {
        const atom = this.system.frame.add_atom(name, x, y, z, props);
        this.world.draw(atom);
    }

    public add_bond = (name:string, i: number, j: number, props = {}) => {
        const bond = this.system.frame.add_bond(name, i, j, props);
        this.world.draw(bond);
    }

    public change_view_mode = (mode: string) => {
        this.world.change_view_mode(mode);
    }

    public use_trajectory = () => {
        this.system = new TrajSystem();
    }

    public draw = () => {
        this.world.draw(this.system.frame);
    }

    public play = () => {
        if (this.system instanceof TrajSystem) {
            this.world.play(this.system.traj);
        }
    }

    public new_frame = () => {
        return new Frame();
    }

    public add_frame = (frame: Frame) => {
        if (this.system instanceof TrajSystem) {
            this.system.traj.add_frame(frame);
        } else {
            this.system.frame = frame;
        }
    }

    public clear = () => {
        this.world.clear();
    }

}
