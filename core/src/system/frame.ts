import { Atom, Bond } from "./item";
import type { IProp } from "./base";

class Frame {
  private _atoms: Atom[];
  private _bonds: Bond[];
  private _props: Map<string, IProp>;

  constructor(atoms: Atom[] = [], bonds: Bond[] = []) {
    this._atoms = atoms;
    this._bonds = bonds;
    this._props = new Map();
  }

  public add_atom(
    name: string,
    x: number,
    y: number,
    z: number,
    props: Record<string, IProp> = {},
  ): Atom {
    const atom = new Atom(name, x, y, z, props);
    this._atoms.push(atom);
    return atom;
  }

  public add_bond(
    itom: Atom,
    jtom: Atom,
    props: Record<string, IProp> = {},
  ): Bond {
    const bond = new Bond(itom, jtom, props);
    this._bonds.push(bond);
    return bond;
  }

  public remove_atom(atom: Atom) {
    this._atoms = this._atoms.filter((a) => a !== atom);
    this._bonds = this._bonds.filter((b) => b.itom !== atom && b.jtom !== atom);
  }

  get atoms(): Atom[] {
    return this._atoms;
  }

  get bonds(): Bond[] {
    return this._bonds;
  }

  public clear() {
    this._atoms = [];
    this._bonds = [];
    this._props = new Map();
  }
}

export { Frame };
