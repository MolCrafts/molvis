import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
class Artist {
    scene;
    constructor(scene) {
        this.scene = scene;
    }
    ;
}
class AtomArtist extends Artist {
    atom_meshes = {};
    draw(atom) {
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
    draw(box) {
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
        ];
        for (let i = 0; i < corners.length; i++) {
            const corner = corners[i];
            let line = MeshBuilder.CreateLines("line", { points: [vectrices[corner[0]], vectrices[corner[1]]] }, this.scene);
        }
    }
}
class FrameArtist extends Artist {
    atom_artist;
    constructor(scene) {
        super(scene);
        this.atom_artist = new AtomArtist(scene);
    }
    draw(frame) {
        const atoms = frame.atoms;
        atoms.map((atom) => {
            return this.atom_artist.draw(atom);
        });
    }
}
export { Artist, AtomArtist, BoxArtist, FrameArtist };
//# sourceMappingURL=artist.js.map