import { Region } from "../model/region";
import { World, IDrawable } from "./world";
import { Vector3, MeshBuilder } from "@babylonjs/core";

export class RegionView implements IDrawable {

    public name: string;
    private world: World;

    constructor(world: World) {
        this.world = world;
        this.name = "RegionView";
    }

    public draw = (region: Region): void => {
        const matrix = region.get_matrix();
        if (matrix === null) {
            return;
        }
        const scene = this.world.scene;
        const vertices = region.get_vertices()!.toArray().map((v: number[]) => new Vector3(v[0], v[1], v[2]));

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
        const linesMesh = MeshBuilder.CreateLineSystem("lines", { lines: lines }, scene);

        // linesMesh.color = new BABYLON.Color3(1, 0, 0); // 红色
    }

}