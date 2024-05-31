import { IModel } from './system';

class Atom implements IModel {
    public name: string;
    public x: number = 0;
    public y: number = 0;
    public z: number = 0;

    constructor(name: string, x: number, y: number, z: number) {
        this.name = name;
        this.x = x;
        this.y = y;
        this.z = z;
    }

};

class Frame implements IModel {

    public atoms: Atom[] = [];
    public name: string = "Frame";

    [key: string]: any;

    constructor() {

    }

    public add_atom = (name: string, { x, y, z }: { x: number, y: number, z: number }): Atom => {
        const atom = new Atom(name, x, y, z);
        this.atoms.push(atom);
        return atom;
    }

    public get_atom_by_name = (name: string): Atom | undefined => {
        return this.atoms.find(atom => atom.name === name);
    }

}

export { Frame, Atom };