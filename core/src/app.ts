import { Controller } from "./controller";
import { World } from "./view/world";

class Molvis {

  private controller: Controller | null = null;
  private world: World | null = null;

  public init(canvas: HTMLCanvasElement) {
    this.world = new World(canvas);
    this.controller = new Controller(this.world);
  }

  public start() {
    if (!this.world) throw new Error('Molvis not initialized');
    this.world.render();
  }

  public get_controller() {
    if (!this.controller) throw new Error('Molvis not initialized');
    return this.controller;
  }

}

export default Molvis;
