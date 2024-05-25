import { NDArray, array, zeros,  } from "vectorious";
import * as BABYLON from "@babylonjs/core";

abstract class Box {

    protected matrix: NDArray;
    protected origin: NDArray;
    protected direction: NDArray;
    protected pbc: boolean[] = [false, false, false];

    constructor(matrix: NDArray, origin: NDArray, direction: NDArray) {
        matrix = this.canonicalize(matrix);
        this.check_matrix(matrix);
        this.matrix = matrix;
        this.origin = origin;
        this.direction = direction;
    }

    public get_matrix() {
        return this.matrix;
    }

    public get inv(): NDArray {
        return this.matrix.inv();
    }

    public get vertices() {

        let vec = [];
        
        vec.push(array([0, 0, 0]));
        vec.push(this.a);
        vec.push(this.b);
        vec.push(this.c);
        vec.push(this.a.add(this.b));
        vec.push(this.a.add(this.c));
        vec.push(this.b.add(this.c));
        vec.push(this.a.add(this.b).add(this.c));

        let vertices = array(vec.map((v)=> v.toArray()));
        vertices.add(this.origin);
        
        return vertices;

    }

    public canonicalize(matrix: NDArray) {
        let _matrix: NDArray = zeros(3, 3);

        if (matrix.shape.length = 1) {
            _matrix.set(0, 0, matrix.get(0));
            _matrix.set(1, 1, matrix.get(1));
            _matrix.set(2, 2, matrix.get(2));
        } else if ((matrix.shape.length = 2)) {
            _matrix = matrix;
        } else throw new Error("Invalid shape");
        return _matrix;
    }

    public check_matrix(matrix: NDArray) {
        if (matrix.det() == 0) {
            throw new Error("Matrix is singular");
        }
    }

    public draw(scene: BABYLON.Scene) {

        let vertices = this.vertices.toArray().map((v) => new BABYLON.Vector3(v[0], v[1], v[2]));

        const lines = [
            [vertices[0], vertices[1]],
            [vertices[1], vertices[4]],
            [vertices[4], vertices[2]],
            [vertices[2], vertices[0]],
    
            [vertices[0], vertices[3]],
            [vertices[1], vertices[5]],
            [vertices[4], vertices[7]],
            [vertices[2], vertices[6]],
    
            [vertices[3], vertices[5]],
            [vertices[5], vertices[7]],
            [vertices[7], vertices[6]],
            [vertices[6], vertices[3]]
        ];
        console.log(lines);

        const linesMesh = BABYLON.MeshBuilder.CreateLineSystem("lines", { lines: lines }, scene);

        // linesMesh.color = new BABYLON.Color3(1, 0, 0); // 红色
    }

    public get a() {
        return array([this.matrix.get(0, 0), this.matrix.get(1, 0), this.matrix.get(2, 0)]);
    }

    public get b() {
        return array([this.matrix.get(0, 1), this.matrix.get(1, 1), this.matrix.get(2, 1)]);
    }

    public get c() {
        return array([this.matrix.get(0, 2), this.matrix.get(1, 2), this.matrix.get(2, 2)]);
    }
}

class FreeSpace {

    public render() { }

}

class OrthogonalBox extends Box {

    constructor(lengths: NDArray, origin: NDArray, direction: NDArray) {

        super(lengths, origin, direction);
    }

    public check_matrix(matrix: NDArray): void {
        super.check_matrix(matrix);
        // TODO: if not diagonal
    }

    public render() {
        console.log(this.vertices);
    }
}

export { Box, OrthogonalBox, FreeSpace };