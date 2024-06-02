import { Region } from './region';
import { Controller } from '../controller';
import { Frame } from './frame';

export interface IModel {
    name: string;
}

export class System {

    public frame: Frame;
    public region: Region;

    private controller: Controller | null = null;

    constructor() {
        this.frame = new Frame();
        this.region = new Region();
    }

}