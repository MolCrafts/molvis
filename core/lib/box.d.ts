declare class Box {
    private _matrix;
    private _origin;
    private _vertices;
    constructor();
    set_lengths_and_angles(lengths: number[], angles: number[]): void;
    get matrix(): number[][];
    set matrix(matrix: number[][]);
    get origin(): number[];
    set origin(origin: number[]);
    get vertices(): number[][];
    set_origin(origin: number[]): void;
    get_matrix(): number[][];
    get_origin(): number[];
    _calc_vertices(): number[][];
}
export { Box };
