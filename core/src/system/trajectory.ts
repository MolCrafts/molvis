import { Frame } from './frame';

class Trajectory {
    private _frames: Frame[] = [];
    private _currentIndex = 0;

    addFrame(frame: Frame) {
        this._frames.push(frame);
    }

    get currentFrame(): Frame {
        if (this._frames.length === 0) {
            // 只在必要时创建初始Frame
            const initialFrame = new Frame();
            this.addFrame(initialFrame);
        }
        return this._frames[this._currentIndex];
    }

    get frames(): Frame[] {
        return this._frames;
    }

    getFrame(idx: number): Frame {
        return this._frames[idx];
    }

    get currentIndex(): number {
        return this._currentIndex;
    }

    set currentIndex(idx: number) {
        this._currentIndex = idx;
    }

    nextFrame() {
        this._currentIndex = Math.min(
            this._currentIndex + 1,
            this._frames.length - 1,
        );
        return this.currentFrame;
    }

    prevFrame() {
        this._currentIndex = Math.max(this._currentIndex - 1, 0);
        return this.currentFrame;
    }
}

export { Trajectory };