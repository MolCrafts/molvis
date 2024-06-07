import { IDrawable, World } from "./world";
import { Frame, Atom, Bond } from "../model/frame";
import { Vector3, MeshBuilder, StandardMaterial, Color3, Quaternion, Mesh, Axis, Matrix } from "@babylonjs/core";
import { Palette, getPalette } from "./palette";
import { modelname2mesh } from "./utils";
import { IModel } from "../model/system";

abstract class Color {
    protected style: string;
    protected palette: Palette;
    protected default_color: string;

    constructor(style: string, n: number) {
        this.style = style;
        const palette = getPalette("Pastel", 4);
        if (palette === undefined) {
            throw new Error(`Palette ${style} not found!`);
        } else {
            this.palette = palette;
        }
        this.default_color = this.palette.colors[0];
    }

    public abstract get_color(model: IModel): string;

    public get_default_color = (): string => {
        return this.default_color;
    }
}

class AtomColor extends Color {

    private mapping: Record<string, number> = {};

    public get_color = (atom: Atom): string => {
        let color = this.default_color;
        let tag = "";
        if ("type" in atom.props) {
            tag = atom.props["type"];
        } else if ("element" in atom.props) {
            tag = atom.props["element"];
        }
        if (tag in this.mapping) {
            color = this.palette.colors[this.mapping[tag]];
        } else {
            this.mapping[tag] = Object.keys(this.mapping).length;
            if (this.mapping[tag] > this.palette.colors.length) {
                this.palette = getPalette(this.style, this.mapping[tag] + 1)!;
            }
            color = this.palette.colors[this.mapping[tag]];
        }
        return color;
    }
}

export class AtomView implements IDrawable {

    static color: Color;

    private world: World;

    constructor(world: World) {
        this.world = world;
        AtomView.color = new AtomColor('Pastel', 1);
    }

    public draw = (atom: Atom): void => {
        const scene = this.world.scene;

        const color = AtomView.color.get_color(atom);

        const mesh_name = modelname2mesh(atom.model_type, atom.name);
        const sphere = MeshBuilder.CreateSphere(mesh_name, { diameter: 0.5 }, scene);
        const material = new StandardMaterial(mesh_name, scene);
        material.diffuseColor = Color3.FromHexString(color);
        sphere.material = material;
        sphere.position = new Vector3(atom.x, atom.y, atom.z);
    }

    public update = (atom: Atom) => {
        const scene = this.world.scene;
        const mesh_name = modelname2mesh(atom.model_type, atom.name);
        const sphere = scene.getMeshByName(mesh_name) as Mesh;
        sphere.position = new Vector3(atom.x, atom.y, atom.z);
    }

    get name() {
        return "Atom";
    }
};

export class BondView implements IDrawable {

    private world: World;

    constructor(world: World) {
        this.world = world;
    }

    static update_connection = (pos1: Vector3, pos2: Vector3) => {
        const distance = pos2.subtract(pos1);
        const height = distance.length();
    
        const pos = pos1.add(distance.scale(0.5));
    
        // 计算连接的方向
        const direction = distance.normalize();
        const up = new Vector3(0, 1, 0);
        const axis = Vector3.Cross(up, direction);
        const angle = Math.acos(Vector3.Dot(up, direction));
        const R = Quaternion.RotationAxis(axis, angle);
        return {
            pos: pos,
            R: R,
            height: height
        }
    }

    public draw = (bond: Bond): void => {
        const scene = this.world.scene;
        const atom_i = bond.itom;
        const atom_j = bond.jtom;
        const atom_i_xyz = new Vector3(atom_i.x, atom_i.y, atom_i.z);
        const atom_j_xyz = new Vector3(atom_j.x, atom_j.y, atom_j.z);
        const atom_i_color = AtomView.color.get_color(atom_i);
        const atom_j_color = AtomView.color.get_color(atom_j);
        const diff = atom_j_xyz.subtract(atom_i_xyz);
        const dist = diff.length();
        
        const mesh_name = modelname2mesh(bond.model_type, bond.name);
        const cylinder1 = MeshBuilder.CreateCylinder(mesh_name, { height: dist/ 2, diameter: 0.1 }, scene);
        // const cylinder2 = MeshBuilder.CreateCylinder(mesh_name, { height: dist/ 2, diameter: 0.1 }, scene);
        const material1 = new StandardMaterial(mesh_name, scene);
        // const material2 = new StandardMaterial(mesh_name, scene);
        material1.diffuseColor = Color3.FromHexString(atom_i_color);
        // material2.diffuseColor = Color3.FromHexString(atom_j_color);
        cylinder1.material = material1;
        const connect = BondView.update_connection(atom_i_xyz, atom_j_xyz);
        cylinder1.position = connect.pos;
        cylinder1.rotationQuaternion = connect.R;
        cylinder1.scaling.y = connect.height;
        // cylinder2.material = material2;
        // cylinder1.position = atom_i_xyz.add(diff.scale(0.25));
        // cylinder2.position = atom_i_xyz.add(diff.scale(0.75));
        // const up = new Vector3(0, 1, 0); // 默认方向
        // const angle = Math.acos(Vector3.Dot(up, diff.normalize()));
        // const axis = Vector3.Cross(up, diff).normalize();
        // const R = Quaternion.RotationAxis(axis, angle);
        // cylinder1.rotationQuaternion = R;
        // cylinder2.rotationQuaternion = R;
        // console.log(cylinder1.position, cylinder1.position);
        // console.log(cylinder2.position, cylinder2.position);
        // const cylinder = Mesh.MergeMeshes([cylinder1, cylinder2], true, true, undefined, false, true)!;
        // console.log(cylinder.position, cylinder.position);
        // cylinder.name = mesh_name;
        // cylinder.position = atom_i_xyz;
        // cylinder.rotationQuaternion = R;
    }

    public update = (bond: Bond) => {
        const scene = this.world.scene;
        const mesh_name = modelname2mesh(bond.model_type, bond.name);
        const cylinder = scene.getMeshByName(mesh_name) as Mesh;
        const atom_i = bond.itom;
        const atom_j = bond.jtom;
        const atom_i_xyz = new Vector3(atom_i.x, atom_i.y, atom_i.z);
        const atom_j_xyz = new Vector3(atom_j.x, atom_j.y, atom_j.z);
        // const diff = atom_j_xyz.subtract(atom_i_xyz);
        // const dist = diff.length();
        // const up = diff; // 默认方向
        // const angle = Math.acos(Vector3.Dot(up, diff.normalize()));
        // const axis = Vector3.Cross(up, diff).normalize();
        // const R = Quaternion.RotationAxis(axis, angle);
        // cylinder.rotationQuaternion = R;
        const connect = BondView.update_connection(atom_i_xyz, atom_j_xyz);
        cylinder.position = connect.pos;
        cylinder.rotationQuaternion = connect.R;
        cylinder.scaling.y = connect.height;
        // cylinder.setPivotPoint(Vector3.Center(atom_i_xyz, atom_j_xyz));
        // cylinder.position = atom_i_xyz;



    }

    get name() {
        return "Bond";
    }

};


export class FrameView implements IDrawable {

    private world: World;

    constructor(world: World) {
        this.world = world;
    }

    public draw = (frame: Frame): void => {
        this.draw_atoms(frame.atoms);
        this.draw_bonds(frame.bonds);
    }

    public draw_atoms = (atoms: Atom[]): void => {
        const drawer = this.world.get_drawable("Atom");
        for (let atom of atoms) {
            drawer.draw(atom);
        }
    }

    public draw_bonds = (bonds: Bond[]): void => {
        const drawer = this.world.get_drawable("Bond");
        for (let bond of bonds) {
            drawer.draw(bond);
        }
    }

    public update = (frame: Frame) => {
        this.update_atoms(frame.atoms);
        this.update_bonds(frame.bonds);
    }

    public update_atoms = (atoms: Atom[]): void => {

        const drawer = this.world.get_drawable("Atom");
        for (let atom of atoms) {
            drawer.update(atom);
        }
    }

    public update_bonds = (bonds: Bond[]): void => {

        const drawer = this.world.get_drawable("Bond");
        for (let bond of bonds) {
            drawer.update(bond);
        }
    
    }

    get name() {
        return "Frame";
    }

}