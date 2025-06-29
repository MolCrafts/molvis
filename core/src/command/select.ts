import type { Mesh } from "@babylonjs/core";
import { registerCommand, type ICommand } from "./base";
import type { Molvis } from "../app";
import type { IEntity } from "../system";

@registerCommand("get_select")
class GetSelect implements ICommand {
    private app: Molvis;
    
    constructor(app: Molvis) {
        this.app = app;
    }
    
    public do(): [Mesh[], IEntity[]] {
        
        const meshes = this.app.world.meshGroup.getSubgroup("selected")?.getChildren() as Mesh[] || [];

        const entities = meshes.map(mesh => {
            return mesh.metadata;
        }).filter(entity => entity !== undefined) as IEntity[];

        return [meshes, entities];
    }
    
    public undo(): [Mesh[], IEntity[]] {
        // Undo logic for selection can be implemented if needed
        return [[], []];
    }
}

export { GetSelect };