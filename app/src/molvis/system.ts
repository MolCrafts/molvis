import { Box } from "./box";

function genId() {
    const id = Math.floor(100000 + Math.random() * 900000);
    return id.toString(16);
}

class Atom {

    private _props: { [key: string]: any } = {};

    constructor(props: { [key: string]: any }) {

        this._props = props;
        this._props["_id"] = genId();

    }

    get props() {
        return this._props;
    }

}

class Bond {

    private _atom1_idx: number;
    private _atom2_idx: number;

    public constructor(atom1_idx: number, atom2_idx: number, props: { [key: string]: any }) {
        this._atom1_idx = atom1_idx;
        this._atom2_idx = atom2_idx;
    }

    get atom1_idx() {
        return this._atom1_idx;
    }

    get atom2_idx() {
        return this._atom2_idx;
    }

}

class AtomVec {

    private _atoms: Atom[] = [];

    [Symbol.iterator](): Iterator<Atom> {
        let index = 0;
    
        return {
          next: (): IteratorResult<Atom> => {
            if (index < this._atoms.length) {
              return {
                value: this._atoms[index++],
                done: false,
              };
            } else {
              return {
                value: null,
                done: true,
              };
            }
          },
        };
      }

    public add_atom(props: { [key: string]: any }) {
        const atom = new Atom(props);
        this._atoms.push(atom);
    }

    public get_props(key: string) {
        const props = [];
        for (let i = 0; i < this._atoms.length; i++) {
            const atom = this._atoms[i];
            props.push(atom.props[key]);
        }
        return props;
    }

}

class BondVec {

    private _bonds: Bond[] = [];

    public add_bond(atom1_idx: number, atom2_idx: number, props: { [key: string]: any }) {
        const bond = new Bond(atom1_idx, atom2_idx, props);
        this._bonds.push(bond);
    }

    public get_connects() {
        const connects = [];
        for (let i = 0; i < this._bonds.length; i++) {
            const bond = this._bonds[i];
            connects.push([bond.atom1_idx, bond.atom2_idx]);
        }
        return connects;
    }

}

class System {

    private _atoms: AtomVec = new AtomVec();
    private _bonds: BondVec = new BondVec();
    private _box: Box = new Box();

    get atoms() {
        return this._atoms;
    }

    get bonds() {
        return this._bonds;
    }

    get box() {
        return this._box;
    }

}

export { System }