import { Controller } from "./controller";
import { World } from "./view/world";
import { System } from "./model/system";

class Molvis {

  private controller: Controller;
  private world: World;
  private system: System;

  constructor(canvas: HTMLCanvasElement) {
    this.world = new World(canvas);
    this.system = new System();
    this.controller = new Controller(this.world, this.system);
  }

  public start() {
    this.world.render();
  }

  public get_controller() {
    return this.controller;
  }

}

export default Molvis;
