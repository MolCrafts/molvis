import { Scene } from "@babylonjs/core/scene";
import { Frame, Atom } from "./frame";
import { Box } from "./box";
declare abstract class Artist {
    protected scene: Scene;
    constructor(scene: Scene);
    abstract draw(item: any): void;
}
declare class AtomArtist extends Artist {
    private atom_meshes;
    draw(atom: Atom): void;
}
declare class BoxArtist extends Artist {
    draw(box: Box): void;
}
declare class FrameArtist extends Artist {
    private atom_artist;
    constructor(scene: Scene);
    draw(frame: Frame): void;
}
export { Artist, AtomArtist, BoxArtist, FrameArtist };
