import { Frame } from "./frame";

export class Trajectory {

    private _frames: Frame[] = [];
    private _steps: number[] = [];

    constructor() {

    }

    public add_frame(frame: Frame, step: number=0) {
        this._frames.push(frame);
        this._steps.push(step);
    }

    get n_frames() {
        return this._frames.length;
    }

    get frames() {
        return this._frames;
    }

    get steps() {
        return this._steps;
    }

}