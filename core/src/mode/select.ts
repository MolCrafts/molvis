
import type { PointerInfo, AbstractMesh } from "@babylonjs/core";
import type { Molvis } from "@molvis/core";

import { BaseMode, ModeType } from "./base";
import { highlight_mesh } from "./utils";

class SelectMode extends BaseMode {
  private selected: AbstractMesh[] = [];

  constructor(app: Molvis) {
    super(ModeType.Select, app);
  }

  override _on_pointer_pick(pointerInfo: PointerInfo): void {
    const pickInfo = pointerInfo.pickInfo;
    if (!pickInfo) return;
    const pickedMesh = pickInfo.pickedMesh;
    if (pickedMesh) {
      this.selected.push(pickedMesh);
      highlight_mesh(pickedMesh);
    }
  }
}

export { SelectMode };
  