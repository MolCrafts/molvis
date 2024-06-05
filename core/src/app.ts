import { Controller } from "./controller";
import { World } from "./view/world";

class Molvis {

  private controller: Controller;
  private world: World;

  constructor(canvas: HTMLCanvasElement) {
    this.world = new World(canvas);
    this.controller = new Controller(this.world);
  }

  public start() {
    this.world.render();
  }

  public get_controller() {
    return this.controller;
  }

}

export default Molvis;
