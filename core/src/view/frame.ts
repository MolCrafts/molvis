import { IDrawable, IDrawables, World } from "./world";
import { Frame, Atom } from "../model/frame";
import { Vector3, MeshBuilder, StandardMaterial, Color3, Color4 } from "@babylonjs/core";
import { Palette, getPalette } from "./palette";

export class AtomView implements IDrawable {

    static palette: Palette;

    public name: string;
    private world: World;

    constructor(world: World, palette: string = "Pastel", material_style: string = "Standard") {
        this.world = world;
        this.name = "Atom";
        AtomView.palette = getPalette(palette, 10)!;
    }

    public refresh_palette = (palette: string, n: number): void => {
        AtomView.palette = getPalette(palette, n)!;
    }

    public draw = (atom: Atom): void => {
        const scene = this.world.scene;
        let color = "";
        if ("type" in atom.props) {
            const type_id = Atom.type_mapping[atom.props["type"]];
            color = AtomView.palette.colors[type_id];
        } else {
            color = AtomView.palette.colors[0];
        }
        const sphere = MeshBuilder.CreateSphere(atom.name, { diameter: 0.5 }, scene);
        const material = new StandardMaterial(atom.name + "Material", scene);
        material.diffuseColor = Color3.FromHexString(color);
        sphere.material = material;
        sphere.position = new Vector3(atom.x, atom.y, atom.z);
    }
}


export class FrameView implements IDrawables {

    public name: string;
    private world: World;
    public drawables: Record<string, IDrawable> = {};

    constructor(world: World) {
        this.world = world;
        this.name = "Frame";
        this.drawables["Atom"] = new AtomView(world);
    }

    public draw = (frame: Frame): void => {

        this.draw_atoms(frame.atoms);

    }

    public draw_atoms(atoms: Atom[]) {

        const n_type = Atom.type_counter;

        const atom_view = this.drawables["Atom"] as AtomView;
        atom_view.refresh_palette("Pastel", n_type);
        atoms.forEach(atom => atom_view.draw(atom));
    }

}