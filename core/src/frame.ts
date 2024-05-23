
class Atom {
    public x: number = 0;
    public y: number = 0;
    public z: number = 0;
    public element: string = '';
    public name: string = '';
    public type: string = '';
    public charge: number = 0;
    public mass: number = 0;
    public molid: number = 0;

    constructor(x: number, y: number, z: number, element: string='', name: string='', type: string='', charge: number=0, mass: number=0, molid: number=0) {
        this.x = x;
        this.y = y;
        this.z = z;
        this.element = element;
        this.name = name;
        this.type = type;
        this.charge = charge;
        this.mass = mass;
        this.molid = molid;
    }

};

class Frame {

    public atoms: Atom[] = [];

    constructor() {
        this.atoms = [];
    }

    public add_atom(x: number, y: number, z: number, element: string='', name: string='', type: string='', charge: number=0, mass: number=0, molid: number=0): Atom {
        const atom = new Atom(x, y, z, element, name, type, charge, mass, molid);
        this.atoms.push(atom);
        return atom;
    }

}

export { Frame, Atom };