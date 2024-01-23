import Modifier from "./modifier"
import { SliceSelector } from "./selector";
import Molvis from "../app"

class Slicer extends Modifier {

    public normx: number = 0;
    public normy: number = 0;
    public normz: number = 0;
    public dist: number = 0;

    constructor(molvis: Molvis, normx: number, normy: number, normz: number, dist: number) {
        super(molvis);
        this.normx = normx;
        this.normy = normy;
        this.normz = normz;
        this.dist = dist;

    }

    public modify() {
        let selector = new SliceSelector(this.molvis, this.normx, this.normy, this.normz, this.dist);
        for (let i = 0; i < selector.selected.length; i++) {
            let mesh = selector.selected[i];
            mesh.isVisible = false;
        }
    }

}