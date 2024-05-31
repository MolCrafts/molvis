import { IDrawable, IDrawables, World } from "./world";
import { Frame, Atom } from "../model/frame";
import { Vector3, MeshBuilder } from "@babylonjs/core";

export class AtomView implements IDrawable {
    
        public name: string;
        private world: World;
    
        constructor(world: World) {
            this.world = world;
            this.name = "Atom";
        }
    
        public draw = (atom: Atom): void => {
            const scene = this.world.scene;
            const sphere = MeshBuilder.CreateSphere(atom.name, { diameter: 0.5 }, scene);
            sphere.position = new Vector3(atom.x, atom.y, atom.z);
        }
}


export class FrameView implements IDrawables {

    public name: string;
    private world: World;
    public drawables: IDrawable[];

    constructor(world: World) {
        this.world = world;
        this.name = "Frame";
        this.drawables = [new AtomView(world)];
    }

    public draw = (frame: Frame): void => {

        this.draw_atoms(frame.atoms);
        
    }

    public draw_atoms(atoms: Atom[]) {
        const atom_view = this.drawables.find(drawable => drawable.name === "Atom");
        atoms.forEach(atom => {
            atom_view!.draw(atom);
        });
    }

}