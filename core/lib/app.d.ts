declare class Molvis {
    private engine;
    private scene;
    private camera;
    private axis;
    private light;
    constructor(canvas: HTMLCanvasElement);
    private init_scene;
    private init_camera;
    private init_light;
    run(): void;
}
export default Molvis;
