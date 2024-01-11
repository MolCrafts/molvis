import Molvis from "./molvis/app";

export interface InitMolvisAppOptions {
    canvas: HTMLCanvasElement;
    assetsHostUrl?: string;
}

export function initMolvisApp(options: InitMolvisAppOptions) {
    if (options.assetsHostUrl) {
        console.log("Assets host URL: " + options.assetsHostUrl!);
    } else {
        console.log("No assets host URL provided");
    }

    const canvas = options.canvas;
    const app = new Molvis(canvas);
    return app;
}

