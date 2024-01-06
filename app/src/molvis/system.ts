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

}

class BondVec {

    private _bonds: Bond[] = [];

    [Symbol.iterator](): Iterator<Bond> {
        let index = 0;
    
        return {
          next: (): IteratorResult<Bond> => {
            if (index < this._bonds.length) {
              return {
                value: this._bonds[index++],
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

    public add_bond(atom1: Atom, atom2: Atom, props: { [key: string]: any }) {
        const bond = new Bond(atom1, atom2, props);
        this._bonds.push(bond);
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