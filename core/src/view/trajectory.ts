import { IPlayable, World } from "./world";
import { Trajectory } from "../model/trajectory";

export class AnimTrajView implements IPlayable {

    private world: World;

    constructor(world: World) {
        this.world = world;
    }

    public play = (trajectory: Trajectory) => {
        const first_frame = trajectory.frames[0];
    }

    get name() {
        return "AnimTrajView";
    }
}

export class RedrawTrajView implements IPlayable {

    private world: World;
    public options: { frame_per_sec: number, loop: boolean };

    constructor(world: World, options: { frame_per_sec: number, loop: boolean }) {
        this.world = world;
        this.options = options;

    }

    public play = (trajectory: Trajectory) => {
        let i = 0;
        const interval = 1000 / this.options.frame_per_sec;
        const redraw = () => {
            this.world.clear();
            console.log(this.world.scene.meshes.length);
            this.world.get_drawable("Frame").draw(trajectory.frames[i]);
        }
        if (this.options.loop) {
            setInterval(() => { redraw(); i = (i + 1) % trajectory.frames.length; }, interval);
        } else {
            for (let i = 0; i < trajectory.frames.length; i++) {
                setTimeout(() => { }, interval);
            }
        }
    }

    get name() {
        return "Trajectory";
    }
}

export class UpdateTrajView implements IPlayable {

    private world: World;
    private options: { frame_per_sec: number, loop: boolean };

    constructor(world: World, options: { frame_per_sec: number, loop: boolean }) {
        this.world = world;
        this.options = options;
    }

    public play = (trajectory: Trajectory) => {

        // draw first frame then update
        const first_frame = trajectory.frames[0];
        this.world.get_drawable("Frame").draw(first_frame);


        let i = 1;
        const interval = 1000 / this.options.frame_per_sec;
        const update = () => {
            this.world.get_drawable("Frame").update(trajectory.frames[i]);
        }
        if (this.options.loop) {
            setInterval(() => { update(); i = (i + 1) % trajectory.frames.length; }, interval);
        } else {
            for (let i = 0; i < trajectory.frames.length; i++) {
                setTimeout(() => { }, interval);
            }
        }
    }

    get name() {
        return "Trajectory";
    }
}
