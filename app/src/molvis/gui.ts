import * as BABYLON from "@babylonjs/core";

function makeTextPlane (text: string, color: string, size: number, scene: BABYLON.Scene) {
    let dynamicTexture = new BABYLON.DynamicTexture("DynamicTexture", 50, scene, true);
    dynamicTexture.hasAlpha = true;
    dynamicTexture.drawText(text, 5, 40, "bold 36px Arial", color, "transparent", true);
    let plane = BABYLON.MeshBuilder.CreatePlane("TextPlane", {size: size, updatable:true}, scene);
    let material = new BABYLON.StandardMaterial("TextPlaneMaterial", scene);
    material.backFaceCulling = false;
    material.specularColor = new BABYLON.Color3(0, 0, 0);
    material.diffuseTexture = dynamicTexture;
    plane.material = material;
    plane.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
    return plane;
};

export { makeTextPlane };