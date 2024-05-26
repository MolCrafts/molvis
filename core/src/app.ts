import Controller from "./controller";
import World from "./world";
import System from "./system";

class Molvis extends Controller {

  constructor(canvas: HTMLCanvasElement) {
    let world = new World(canvas);
    let system = new System(world);
    super(world, system);
  }

  public draw() {
    this.system.draw();
  }

  public update() {
    this.system.update();
  }

  public render() {
    this.world.render();
  }

}

export default Molvis;
