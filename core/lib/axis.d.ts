import { Engine } from "@babylonjs/core/Engines/engine";
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
declare class AxisHelper {
    private _scene;
    constructor(engine: Engine, camera: ArcRotateCamera);
    render(): void;
}
export { AxisHelper };
