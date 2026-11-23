import { expect, it, rstest } from "@rstest/core";
import type { MolvisApp } from "../../src/app";
import { BALL_AND_STICK } from "../../src/artist/representation";
import { hydrateProject } from "../../src/project/hydrate";

rstest.mock("../../src/camera/control", () => ({
  setCameraPose: (camera: { saved?: unknown }, pose: unknown) => {
    camera.saved = pose;
  },
}));

function document() {
  return {
    format: "molvis.project/v2",
    version: 2,
    createdAt: "2026-11-20T00:00:00Z",
    pipeline: [],
    view: {
      camera: {
        alpha: 0,
        beta: 1,
        radius: 10,
        target: [0, 0, 0],
        position: [0, 0, 10],
        up: [0, 1, 0],
      },
      representation: BALL_AND_STICK,
      showBox: false,
      coloring: { categoricalTheme: "ovito", bondColorMode: "theme" },
      materials: {
        atom: { shading: "lit", specular: 0.7, specularPower: 48 },
        bond: { shading: "flat", specular: 0, specularPower: 4 },
      },
      lighting: { lightDir: [0, 0, -1], ambient: 0.3, diffuse: 0.5 },
      effects: {
        outlineEnabled: true,
        atomOutline: 0.1,
        bondOutline: 0.2,
        ssao: false,
        dof: false,
      },
      background: "#12345680",
    },
  };
}

it("validates the entire appearance before touching the current scene", async () => {
  const zeroUp = document();
  zeroUp.view.camera.up = [0, 0, 0];
  await expect(hydrateProject({} as MolvisApp, zeroUp)).rejects.toThrow(
    /nonzero/,
  );
  const project = document();
  project.view.materials.atom.specular = -1;
  await expect(hydrateProject({} as MolvisApp, project)).rejects.toThrow(
    /non-negative/,
  );
  await expect(
    hydrateProject({} as MolvisApp, { ...document(), version: 99 }),
  ).rejects.toThrow(/invalid/);
});

it("installs restored style and camera before the final geometry build", async () => {
  const state: Record<string, unknown> = {};
  const camera: {
    saved?: unknown;
    upVector?: { x: number; y: number; z: number };
  } = {};
  let draws = 0;
  const app = {
    system: { resetToEmpty() {} },
    modifierPipeline: { clear() {} },
    styleManager: {
      setRepresentation: (value: unknown) => {
        state.geometry = value;
      },
      setMaterial: (target: string, value: unknown) => {
        state[target] = value;
      },
      setCategoricalTheme: (value: unknown) => {
        state.theme = value;
      },
      setBondColorMode: (value: unknown) => {
        state.colorMode = value;
      },
      setShowBox: (value: unknown) => {
        state.box = value;
      },
    },
    settings: {
      setLighting: (value: unknown) => {
        state.lighting = value;
      },
      setEffects: (value: unknown) => {
        state.effects = value;
      },
    },
    setBackgroundColor: (value: unknown) => {
      state.background = value;
    },
    world: { camera, renderOnce() {} },
    events: { emit() {} },
    applyPipeline: async () => {
      draws++;
      expect(state.atom).toEqual(document().view.materials.atom);
      expect(state.geometry).toEqual(BALL_AND_STICK);
      expect(state.theme).toBe("ovito");
      expect(state.background).toBe("#12345680");
      expect(camera.saved).toEqual(document().view.camera);
      expect([
        camera.upVector?.x,
        camera.upVector?.y,
        camera.upVector?.z,
      ]).toEqual([0, 1, 0]);
    },
  } as unknown as MolvisApp;
  await hydrateProject(app, document());
  expect(draws).toBe(1);
});
