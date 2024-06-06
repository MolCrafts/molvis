import { Region } from './region';
import { Controller } from '../controller';
import { Frame } from './frame';
import { Trajectory } from './trajectory';

export interface IModel {
    name: string;
}

export interface ISystem { 
    set_controller(controller: Controller): void;
    get frame(): Frame;
}

abstract class System implements ISystem {

    private controller: Controller | null = null;

    public set_controller(controller: Controller) {
        this.controller = controller;
    }

    abstract get frame(): Frame;

}

export class FrameSystem extends System {
    
    public _frame: Frame = new Frame();
    // public region: Region = new Region();

    get frame() {
        return this._frame;
    }

    set frame(frame: Frame) {
        this._frame = frame;
    }

}

export class TrajSystem extends FrameSystem {

    public traj: Trajectory = new Trajectory();
    public current: number = 0;

    get frame() {
        return this.traj.frames[this.current];
    }

    get current_step() {
        return this.traj.steps[this.current];
    }

    public add_frame(frame: Frame, step: number=0) {
        this.traj.add_frame(frame, step);
    }

}