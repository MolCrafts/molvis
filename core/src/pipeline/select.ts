import type { IEntity } from "../system/base";
import type { IModifier } from "./base";
import { registerModifier } from "./base";
import type { Mesh } from "@babylonjs/core";
import type { Molvis } from "@molvis/core";

@registerModifier("type_select")
class TypeSelect implements IModifier {
  private _type: string;

  constructor(args: {type: string}) {
    const type = args.type;
    this._type = type;
  }

  public modify(
    app: Molvis,
    selected: Mesh[],
    entities: IEntity[],
  ): [Mesh[], IEntity[]] {
    const new_selected = [];
    const new_items = [];
    for (let i = 0; i < selected.length; i++) {
      const item = entities[i];
      if (item.get("type") === this._type) {
        new_selected.push(selected[i]);
        new_items.push(item);
      }
    }
    app.world.meshGroup.addMeshs(
      new_selected,
      "selected",
    )
    return [new_selected, new_items];
  }
}

export { TypeSelect };
