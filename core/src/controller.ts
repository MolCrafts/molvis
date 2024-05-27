import World from "./world";
import System from "./system";
import { IJsonPRCRequest } from "./rpc/protocol";

class Controller {

    protected world: World;
    public system: System;

    [key: string]: any;

    constructor(world: World, system: System) {
        this.world = world;
        this.system = system;
    }

    public response_json(request: IJsonPRCRequest) {
        
        let method = request.method;
        let params = request.params;

        let tar:any = this;
        for (let t of method.split(".")) {
            tar = tar[t];
        }
        tar(...Object.values(params));
    }

}

export default Controller;