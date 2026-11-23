import { expect, it } from "@rstest/core";
import { BALL_AND_STICK } from "../../src/artist/representation";
import { ProjectView } from "../../src/project/view";

const legacy = {
  camera: {
    alpha: 0.1,
    beta: 0.2,
    radius: 10,
    target: [0, 0, 0],
    position: [0, 0, 10],
    up: [0, 1, 0],
  },
  showBox: true,
  representation: {
    ...BALL_AND_STICK,
    id: "flat",
    name: "Flat",
    atomShading: "flat",
    bondShading: "flat",
    atomOutline: 0.12,
    bondOutline: 0.2,
    outlineEnabled: true,
    outlineConfigurable: true,
    bondColorMode: "split",
  },
};
it("migrates stored v1 fields to stable defaults independently of current presets", () => {
  const view = new ProjectView(legacy, true);
  expect(view.representation.id).toBe("ball-and-stick");
  expect(view.representation.name).toBe("Ball and Stick");
  expect(view.materials.atom).toEqual({
    shading: "flat",
    specular: 0,
    specularPower: 4,
  });
  expect(view.effects.atomOutline).toBe(0.12);
  expect(view.lighting).toEqual({
    lightDir: [0.5, 0.5, -1],
    ambient: 0.4,
    diffuse: 0.4,
  });
  expect(view.background).toBe("#33334D");
});
it("round-trips custom v2 values and rejects invalid material without mutating input", () => {
  const view = new ProjectView(legacy, true);
  view.materials.atom = { shading: "lit", specular: 0.73, specularPower: 57 };
  view.background = "#12345680";
  expect(new ProjectView(JSON.parse(JSON.stringify(view)))).toEqual(view);
  const invalid = {
    ...view,
    materials: {
      ...view.materials,
      atom: { ...view.materials.atom, metalness: 1 },
    },
  };
  expect(() => new ProjectView(invalid)).toThrow(/Unknown material/);
  expect(view.materials.atom.specular).toBe(0.73);
});
