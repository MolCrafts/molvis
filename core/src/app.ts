import { array } from "vectorious";
import { AxesViewer } from "./axis";
import { Box, OrthogonalBox } from "./box";
import World from "./world";
// import { System } from "./system";

class Molvis {
  private world: World;
  private box: Box | null = null;
  private axis: AxesViewer;
  // private system: System;

  constructor(canvas: HTMLCanvasElement) {
    this.world = new World(canvas);
    this.axis = new AxesViewer(this.world);
    // this.system = new System();
  }

  public set_orthogonal_box(
    lengths: number[],
    origin: number[],
    direction: number[]
  ) {
    this.box = new OrthogonalBox(array(lengths), array(origin), array(direction));
    this.box.draw(this.world.scene);

  }

  public render() {
    this.world.add_renderable(this.axis);
    this.world.render();
  }
}

export default Molvis;
