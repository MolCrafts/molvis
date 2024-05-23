class Atom {
    x = 0;
    y = 0;
    z = 0;
    element = '';
    name = '';
    type = '';
    charge = 0;
    mass = 0;
    molid = 0;
    constructor(x, y, z, element = '', name = '', type = '', charge = 0, mass = 0, molid = 0) {
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
}
;
class Frame {
    atoms = [];
    constructor() {
        this.atoms = [];
    }
    add_atom(x, y, z, element = '', name = '', type = '', charge = 0, mass = 0, molid = 0) {
        const atom = new Atom(x, y, z, element, name, type, charge, mass, molid);
        this.atoms.push(atom);
        return atom;
    }
}
export { Frame, Atom };
//# sourceMappingURL=frame.js.map