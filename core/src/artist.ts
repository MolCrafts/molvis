import { Scene } from "@babylonjs/core/scene";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Frame, Atom } from "./frame";
import { Box } from "./box";

abstract class Artist {

    protected scene: Scene;

    constructor(scene: Scene) {
        this.scene = scene;
    };

    abstract draw(item: any): void;
}

class AtomArtist extends Artist {

    private atom_meshes: { [key: string]: Mesh } = {};

    public draw(atom: Atom): void {

        let atom_mesh = this.atom_meshes?.[atom.name];
        if (!atom_mesh) {
            atom_mesh = MeshBuilder.CreateSphere(atom.name, { diameter: 1 }, this.scene);
            this.atom_meshes[atom.name] = atom_mesh;
        }
        else {
            atom_mesh.position = new Vector3(atom.x, atom.y, atom.z);
        }
    }
}

class BoxArtist extends Artist {

    public draw(box: Box): void {

        const vectrices = box.vertices.map((v) => {
            return new Vector3(v[0], v[1], v[2]);
        });
        const corners = [
            [0, 1],
            [1, 2],
            [2, 3],
            [3, 0],
            [4, 5],
            [5, 6],
            [6, 7],
            [7, 4],
            [0, 4],
            [1, 5],
            [2, 6],
            [3, 7]
        ]
        for (let i = 0; i < corners.length; i++) {
            const corner = corners[i];
            let line = MeshBuilder.CreateLines("line", { points: [vectrices[corner[0]], vectrices[corner[1]]] }, this.scene);
        }
    }
}

class FrameArtist extends Artist {

    private atom_artist: AtomArtist;

    constructor(scene: Scene) {
        super(scene);
        this.atom_artist = new AtomArtist(scene);
    }

    public draw(frame: Frame): void {
        const atoms = frame.atoms;
        atoms.map((atom) => {
            return this.atom_artist.draw(atom);
        });
    }

}

export { Artist, AtomArtist, BoxArtist, FrameArtist };