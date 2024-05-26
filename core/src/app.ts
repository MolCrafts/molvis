import World from "./world";
import System from "./system";

class Molvis {
  private world: World;
  public system: System;

  constructor(canvas: HTMLCanvasElement) {
    this.world = new World(canvas);
    this.system = new System(this.world);
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
