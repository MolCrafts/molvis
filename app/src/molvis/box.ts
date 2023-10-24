import {array, NDArray, zeros} from 'vectorious';

class Box {

    private _matrix: NDArray = zeros(3, 3);
    private _origin: NDArray = zeros(3);

    constructor() {

    }

    public set_lengths_and_angles(lengths: number[], angles: number[]) {
        let [a, b, c] = lengths;
        let [alpha, beta, gamma] = angles;
        let lx = a;
        let xy = b * Math.cos(gamma);
        let xz = c * Math.cos(beta);
        let ly = Math.sqrt(b * b - xy * xy);
        let yz = (b * c * Math.cos(alpha) - xy * xz) / ly;
        let lz = Math.sqrt(c * c - xz * xz - yz * yz);

        this._matrix = array([
            [lx, 0, 0],
            [xy, ly, 0],
            [xz, yz, lz]
        ]);
    }

    public set_origin(origin: number[]) {
        this._origin = array(origin);
    }

    public get_matrix() {
        return this._matrix;
    }

    public get_origin() {
        return this._origin;
    }

    public get_vertices() {
        let lx = this._matrix.get(0, 0);
        let ly = this._matrix.get(1, 1);
        let lz = this._matrix.get(2, 2);
        let ox = this._origin.get(0);
        let oy = this._origin.get(1);
        let oz = this._origin.get(2);

        let vertices = [
            [ox, oy, oz],
            [ox + lx, oy, oz],
            [ox + lx, oy + ly, oz],
            [ox, oy + ly, oz],
            [ox, oy, oz + lz],
            [ox + lx, oy, oz + lz],
            [ox + lx, oy + ly, oz + lz],
            [ox, oy + ly, oz + lz]
        ];
        return vertices;
    }

}

export { Box }