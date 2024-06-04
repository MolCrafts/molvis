import { IDrawable, IDrawables, World } from "./world";
import { Frame, Atom, Bond } from "../model/frame";
import { Vector3, MeshBuilder, StandardMaterial, Color3, Quaternion } from "@babylonjs/core";
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
        const mesh_name = `<Atom: ${atom.name}>`;
        const sphere = MeshBuilder.CreateSphere(mesh_name, { diameter: 0.5 }, scene);
        const material = new StandardMaterial(atom.name + "_material", scene);
        material.diffuseColor = Color3.FromHexString(color);
        sphere.material = material;
        sphere.position = new Vector3(atom.x, atom.y, atom.z);
    }
};

export class BondView implements IDrawable {

    public name: string;
    private world: World;

    constructor(world: World) {
        this.world = world;
        this.name = "Bond";
    }

    public draw = (bond: Bond): void => {
        const scene = this.world.scene;
        const atom_i = bond.itom;
        const atom_j = bond.jtom;
        const diff = new Vector3(atom_j.x - atom_i.x, atom_j.y - atom_i.y, atom_j.z - atom_i.z);
        const dist = diff.length();
        const mid = new Vector3(atom_i.x + diff.x / 2, atom_i.y + diff.y / 2, atom_i.z + diff.z / 2);
        const mesh_name = `<Bond: ${bond.name}>`;
        const cylinder = MeshBuilder.CreateCylinder(mesh_name, { height: dist, diameter: 0.1 }, scene);
        const material = new StandardMaterial(mesh_name + "_aterial", scene);
        material.diffuseColor = Color3.FromHexString("#000000");
        cylinder.material = material;
        cylinder.position = mid;
        const up = new Vector3(0, 1, 0); // 默认方向
        const angle = Math.acos(Vector3.Dot(up, diff.normalize()));
        const axis = Vector3.Cross(up, diff).normalize();
        cylinder.rotationQuaternion = Quaternion.RotationAxis(axis, angle);

    }

};


export class FrameView implements IDrawables {

    public name: string;
    private world: World;
    public drawables: Record<string, IDrawable> = {};

    constructor(world: World) {
        this.world = world;
        this.name = "Frame";
        this.drawables["Atom"] = new AtomView(world);
        this.drawables["Bond"] = new BondView(world);
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