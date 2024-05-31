import { NDArray, array, zeros, } from "vectorious";
import { IModel } from "./system";

abstract class Boundary {

    constructor() {
    }
}

abstract class BoxModel extends Boundary {

    protected matrix: NDArray;
    protected origin: NDArray;
    protected direction: NDArray;
    protected pbc: boolean[];

    constructor(matrix: NDArray, origin: NDArray, direction: NDArray, pbc: boolean[] = [false, false, false]) {
        
        super();
        
        matrix = this.canonicalize(matrix);
        this.check_matrix(matrix);
        this.matrix = matrix;
        this.origin = origin;
        this.direction = direction;
        this.pbc = pbc;
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

class Free extends Boundary {

    constructor() {
        super();
    }

}

class OrthogonalBox extends BoxModel {

    constructor(lengths: NDArray, origin: NDArray, direction: NDArray, pbc: boolean[] = [false, false, false]) {
        super(lengths, origin, direction, pbc);
    }

    public check_matrix(matrix: NDArray): void {
        super.check_matrix(matrix);
        // TODO: if not diagonal
    }

}

class Region implements IModel {

    public name: string = "Box";

    private model: Boundary = new Free();

    constructor() {
    }

    public get_matrix = () : NDArray|null =>  {
        if (this.model instanceof BoxModel) {
            return this.model.get_matrix();
        }
        return null;
    }

    public get_vertices = () : NDArray|null => {
        if (this.model instanceof BoxModel) {
            return this.model.vertices;
        }
        return null;
    }

    public set_orthogonal_box = (lengths: number[],
        origin: number[],
        direction: number[]) => {
        this.model = new OrthogonalBox(array(lengths), array(origin), array(direction));
        return this;
    }

}

export { Region, OrthogonalBox, Free };