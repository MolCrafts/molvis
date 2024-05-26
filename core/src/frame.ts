import World from "./world";
import * as BABYLON from "@babylonjs/core";

class Atom {
    public name: string;
    public x: number = 0;
    public y: number = 0;
    public z: number = 0;

    constructor(name:string, x: number, y: number, z: number) {
        this.name = name;
        this.x = x;
        this.y = y;
        this.z = z;
    }

};

class Frame {

    private world: World;
    public atoms: Atom[] = [];

    constructor(world:World) {
        this.world = world;
        this.atoms = [];
    }

    public add_atom(name:string, x: number, y: number, z: number): Atom {
        const atom = new Atom(name, x, y, z);
        this.atoms.push(atom);
        this.draw_atom(atom);
        return atom;
    }

    public draw_atom(atom: Atom) {
        BABYLON.MeshBuilder.CreateSphere(atom.name, {
            diameter: 1
        }, this.world.scene);
    }

}

export { Frame, Atom };