import { Box } from "./box";

class Atom {

    public props: { [key: string]: any } = {};

    constructor(props: { [key: string]: any }) {
        this.props = props;
    }

}

class Bond {

    private _atom1: Atom;
    private _atom2: Atom;
    private _props: { [key: string]: any } = {};

    public constructor(atom1: Atom, atom2: Atom, props: { [key: string]: any }) {
        this._atom1 = atom1;
        this._atom2 = atom2;
        this._props = props;
    }

    get atom1() {
        return this._atom1;
    }

    get atom2() {
        return this._atom2;
    }

}

class System {

    private _atoms: Atom[] = [];
    private _bonds: Bond[] = [];
    private _box: Box = new Box();

    get atoms() {
        return this._atoms;
    }

    public add_atom(props: { [key: string]: any }) {
        const atom = new Atom(props);
        this._atoms.push(atom);
        return atom;
    }

    public get_props(key: string) {
        const props = [];
        for (let i = 0; i < this._atoms.length; i++) {
            const atom = this._atoms[i];
            props.push(atom.props[key]);
        }
        return props;
    }

    get bonds() {
        return this._bonds;
    }

    public add_bond(atom1: Atom, atom2: Atom, props: { [key: string]: any }) {
        const bond = new Bond(atom1, atom2, props);
        this._bonds.push(bond);
    }

    get box() {
        return this._box;
    }

    get natoms() {
        return this._atoms.length;
    }

}

export { System }