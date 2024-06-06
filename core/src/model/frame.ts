import { IModel } from './system';

export class Atom implements IModel {

    static type_mapping: Record<string, number> = {};
    static type_counter: number = 0;

    public name: string;
    public x: number = 0;
    public y: number = 0;
    public z: number = 0;
    public props: Record<string, any> = {};

    constructor(name: string, x: number, y: number, z: number, props: Record<string, any> = {}) {
        this.name = name;
        this.x = x;
        this.y = y;
        this.z = z;
        this.props = props;

        if ("type" in props) {
            if (!(props["type"] in Atom.type_mapping)) {
                Atom.type_mapping[props["type"]] = Atom.type_counter;
                Atom.type_counter += 1;
            }
        }

    }

    public get model_type(): string {
        return "Atom";
    }

};

export class Bond implements IModel {

    public name: string;
    public itom: Atom;
    public jtom: Atom;
    public props: Record<string, any> = {};

    constructor(name: string, itom: Atom, jtom: Atom, props: Record<string, any> = {}) {
        this.name = name;
        this.itom = itom;
        this.jtom = jtom;
        this.props = props;
    }

    get length(): number {
        return Math.sqrt((this.itom.x - this.jtom.x) ** 2 + (this.itom.y - this.jtom.y) ** 2 + (this.itom.z - this.jtom.z) ** 2);
    }

    get model_type(): string {
        return "Bond";
    }
};

export class Frame implements IModel {

    public atoms: Atom[] = [];
    public bonds: Bond[] = [];
    public name: string = "Frame";

    [key: string]: any;

    constructor() {

    }

    public add_atom = (name: string, x: number, y: number, z: number , props = {}): Atom => {
        if ("type" in props) {

        }
        const atom = new Atom(name, x, y, z, props);
        this.atoms.push(atom);
        return atom;
    }

    public add_bond = (name: string, idx_i: number, idx_j: number, props = {}): Bond => {
        const bond = new Bond(name, this.atoms[idx_i], this.atoms[idx_j], props);
        this.bonds.push(bond);
        return bond;
    }

    public get_atom_by_name = (name: string): Atom | undefined => {
        return this.atoms.find(atom => atom.name === name);
    }

    public get_atoms_by_tags = (tags: Record<string, any> = {}): Atom[] => {
        return this.atoms.filter(atom => {
            for (let k in tags) {
                if (atom.props[k] !== tags[k]) return false;
            }
            return true;
        });
    }

    public get model_type(): string {
        return "Frame";
    }

    public get n_atoms(): number {
        return this.atoms.length;
    }

}
