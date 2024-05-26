import { NDArray, array, zeros, } from "vectorious";
import * as BABYLON from "@babylonjs/core";
import World from "./world";

abstract class BoxModel {

    protected matrix: NDArray;
    protected origin: NDArray;
    protected direction: NDArray;
    protected pbc: boolean[] = [false, false, false];
    public drawable: boolean = true;

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

        let vertices = array(vec.map((v) => v.toArray()));
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

class FreeSpace extends BoxModel {

    constructor() {
        super(zeros(3, 3), zeros(3), zeros(3));
        this.drawable = false;
    }

    public canonicalize(matrix: NDArray): NDArray {
        return matrix;
    }

    public check_matrix(matrix: NDArray): void {
    }

}

class OrthogonalBox extends BoxModel {

    constructor(lengths: NDArray, origin: NDArray, direction: NDArray) {

        super(lengths, origin, direction);
    }

    public check_matrix(matrix: NDArray): void {
        super.check_matrix(matrix);
        // TODO: if not diagonal
    }

}

class Box {

    private world: World;
    private box: BoxModel = new FreeSpace();

    [key: string]: any;

    constructor(world: World) {
        this.world = world;
    }

    public set_orthogonal_box(lengths: number[],
        origin: number[],
        direction: number[]) {
            this.box = new OrthogonalBox(array(lengths), array(origin), array(direction));
        }

    public draw(): void {
        if (!this.box.drawable) return;
        let scene = this.world.scene;

        let vertices = this.box.vertices.toArray().map((v: number[]) => new BABYLON.Vector3(v[0], v[1], v[2]));

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

        const linesMesh = BABYLON.MeshBuilder.CreateLineSystem("lines", { lines: lines }, scene);

        // linesMesh.color = new BABYLON.Color3(1, 0, 0); // 红色
    }

}

export { Box, OrthogonalBox, FreeSpace };