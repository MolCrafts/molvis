import { Frame } from "./frame";
import { IModel } from "./system";

export class Trajectory implements IModel {

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

    get name() {
        return "Trajectory";
    }

}