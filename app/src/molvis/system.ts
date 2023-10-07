class Atom {

    private _props: { [key: string]: any } = {};

    public get(key: string) {
        return this._props[key];
    }

    public set(key: string, value: any) {
        this._props[key] = value;
    }

}

class System {

    private _atoms: Atom[] = [];

    get atoms() {
        return this._atoms;
    }

    public add_atom(props: { [key: string]: any }) {
        const atom = new Atom();
        for (const key in props) {
            atom.set(key, props[key]);
        }
        this._atoms.push(atom);
    }

}

export { System, Atom }