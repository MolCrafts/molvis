declare class Atom {
    x: number;
    y: number;
    z: number;
    element: string;
    name: string;
    type: string;
    charge: number;
    mass: number;
    molid: number;
    constructor(x: number, y: number, z: number, element?: string, name?: string, type?: string, charge?: number, mass?: number, molid?: number);
}
declare class Frame {
    atoms: Atom[];
    constructor();
    add_atom(x: number, y: number, z: number, element?: string, name?: string, type?: string, charge?: number, mass?: number, molid?: number): Atom;
}
export { Frame, Atom };
