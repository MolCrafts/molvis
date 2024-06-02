import { IModel } from './system';

class Atom implements IModel {

    static type_mapping: Record<string, number> = {};
    static type_counter: number = 0;

    public name: string;
    public x: number = 0;
    public y: number = 0;
    public z: number = 0;
    public props: Record<string, any> = {};

    constructor(name: string, x: number, y: number, z: number, props: Record<string, any>={}) {
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

};

class Frame implements IModel {

    public atoms: Atom[] = [];
    public name: string = "Frame";

    [key: string]: any;

    constructor() {

    }

    public add_atom = (name: string, { x, y, z }: { x: number, y: number, z: number }, props={}): Atom => {
        if ("type" in props) {

        }
        const atom = new Atom(name, x, y, z, props);
        this.atoms.push(atom);
        return atom;
    }

    public get_atom_by_name = (name: string): Atom | undefined => {
        return this.atoms.find(atom => atom.name === name);
    }

    public get_atoms_by_tags = (tags:Record<string, any> = {}): Atom[] => {
        return this.atoms.filter(atom => {
            for (let k in tags) {
                if (atom.props[k] !== tags[k]) return false;
            }
            return true;
        });
    }

}

export { Frame, Atom };