import { Frame } from "./frame";
import { Atom, Bond } from "./item";
import { Trajectory } from "./trajectory";
import type { IEntity, IProp } from "./base";

class System {
  private _selected: Atom[];
  private _trajectory: Trajectory;
  private _singleFrameMode = true;

  constructor() {
    this._trajectory = new Trajectory();
    this._selected = [];
  }

  public get trajectory() {
    return this._trajectory;
  }

  public get current_frame() {
    return this._trajectory.currentFrame;
  }

  public set current_frame_index(idx: number) {
    this._trajectory.currentIndex = idx;
  }

  public get current_frame_index(): number {
    return this._trajectory.currentIndex;
  }

  public getFrame(idx: number): Frame | undefined {
    return this._trajectory.getFrame(idx);
  }

  public set_frame(idx: number) {
    if (this._singleFrameMode) return;
    this._trajectory.currentIndex = idx;
  }

  public next_frame() {
    if (this._singleFrameMode) {
      return this._trajectory.currentFrame;
    }
    return this._trajectory.nextFrame();
  }

  public prev_frame() {
    if (this._singleFrameMode) {
      return this._trajectory.currentFrame;
    }
    return this._trajectory.prevFrame();
  }

  static random_atom_id(): string {
    const randomNum = Math.floor(Math.random() * 0x10000);

    const hexID = randomNum.toString(16).padStart(4, "0");

    return hexID;
  }

  public select_atom(atom: Atom) {
    this._selected.push(atom);
  }

  public append_frame(frame: Frame) {
    this._trajectory.addFrame(frame);
    this._singleFrameMode = this._trajectory.frames.length === 1;
  }

  get n_frames(): number {
    return this._trajectory.frames.length;
  }

  get single_frame_mode(): boolean {
    return this._singleFrameMode;
  }
}

// Export ECS-based classes
export { System, Frame, Atom, Bond, Trajectory };
export type { IEntity, IProp };
