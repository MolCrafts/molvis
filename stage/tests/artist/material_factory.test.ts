import { Matrix, type Scene, type ShaderMaterial } from "@babylonjs/core";
import { expect, it } from "@rstest/core";
import { syncImpostorMaterialUniforms } from "../../src/artist/material_factory";

it("binds each surface independently while preserving lighting and picking", () => {
  const floats = new Map<string, number>();
  const material = {
    setFloat: (key: string, value: number) => floats.set(key, value),
    setMatrix() {},
    setColor3() {},
    setVector3() {},
  } as unknown as ShaderMaterial;
  const scene = {
    getViewMatrix: () => Matrix.Identity(),
    getProjectionMatrix: () => Matrix.Identity(),
    clearColor: { r: 1, g: 1, b: 1 },
  } as unknown as Scene;
  const host = {
    styleManager: {
      getMaterial: (target: string) => ({
        shading: "lit" as const,
        specular: target === "atom" ? 0.8 : 0.1,
        specularPower: target === "atom" ? 64 : 4,
      }),
    },
    settings: {
      getLighting: () => ({
        lightDir: [0.5, 0.5, -1] as [number, number, number],
        ambient: 0.4,
        diffuse: 0.4,
      }),
      getEffects: () => ({
        outlineEnabled: true,
        atomOutline: 0.12,
        bondOutline: 0.2,
        ssao: false,
        dof: false,
      }),
    },
    config: { useRightHandedSystem: true },
    world: { picker: { isPicking: true } },
  };
  syncImpostorMaterialUniforms(material, scene, "atom", host);
  expect(floats.get("materialSpecular")).toBe(0.8);
  expect(floats.get("materialSpecularPower")).toBe(64);
  expect(floats.get("outlineWidth")).toBe(0.12);
  syncImpostorMaterialUniforms(material, scene, "bond", host);
  expect(floats.get("materialSpecular")).toBe(0.1);
  expect(floats.get("outlineWidth")).toBe(0.2);
  expect(floats.get("uPickingEnabled")).toBe(1);
  expect(floats.get("lightAmbient")).toBe(0.4);
});
