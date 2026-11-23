import { Material } from "../artist/material";
import { Representation } from "../artist/representation";
import { Settings } from "../settings";
import type { ProjectViewState } from "./types";

/** Portable view validation and the fixed v1 migration. No live app is mutated. */
export class ProjectView implements ProjectViewState {
  declare readonly camera: ProjectViewState["camera"];
  declare readonly representation: ProjectViewState["representation"];
  declare readonly showBox: boolean;
  declare readonly coloring: ProjectViewState["coloring"];
  declare readonly materials: ProjectViewState["materials"];
  declare readonly lighting: ProjectViewState["lighting"];
  declare readonly effects: ProjectViewState["effects"];
  declare background: string;

  constructor(input: unknown, legacy = false) {
    if (!input || typeof input !== "object" || Array.isArray(input))
      throw new Error("Invalid project view");
    let value = input as ProjectViewState;
    if (legacy) {
      const old = value.representation as unknown as Record<string, unknown>;
      if (!old || typeof old !== "object")
        throw new Error("Missing v1 representation");
      const {
        atomShading,
        bondShading,
        atomOutline,
        bondOutline,
        outlineEnabled,
        outlineConfigurable: _ui,
        bondColorMode,
        ...geometry
      } = old;
      value = {
        camera: value.camera,
        showBox: value.showBox,
        representation: new Representation({
          ...geometry,
          id: geometry.id === "flat" ? "ball-and-stick" : geometry.id,
          name: geometry.id === "flat" ? "Ball and Stick" : geometry.name,
        }),
        coloring: {
          categoricalTheme: "tab10",
          bondColorMode: bondColorMode as "split" | "theme",
        },
        materials: {
          atom: new Material({
            shading: atomShading,
            specular: 0,
            specularPower: 4,
          }),
          bond: new Material({
            shading: bondShading,
            specular: 0,
            specularPower: 4,
          }),
        },
        lighting: { lightDir: [0.5, 0.5, -1], ambient: 0.4, diffuse: 0.4 },
        effects: {
          outlineEnabled,
          atomOutline,
          bondOutline,
          ssao: false,
          dof: false,
        } as ProjectViewState["effects"],
        background: "#33334D",
      };
    }
    const camera = value.camera;
    if (
      !camera ||
      ![camera.alpha, camera.beta, camera.radius].every(
        (x) => typeof x === "number" && Number.isFinite(x),
      ) ||
      camera.radius <= 0
    )
      throw new Error("Invalid project camera");
    for (const key of ["target", "position", "up"] as const)
      if (
        !Array.isArray(camera[key]) ||
        camera[key].length !== 3 ||
        !camera[key].every((x) => typeof x === "number" && Number.isFinite(x))
      )
        throw new Error(`Invalid project camera.${key}`);
    if (camera.up.every((component) => component === 0))
      throw new Error("Project camera.up must be nonzero");
    if (typeof value.showBox !== "boolean")
      throw new Error("Invalid project box visibility");
    if (
      !value.coloring ||
      !["tab10", "ovito"].includes(value.coloring.categoricalTheme) ||
      !["split", "theme"].includes(value.coloring.bondColorMode)
    )
      throw new Error("Invalid project coloring");
    if (
      typeof value.background !== "string" ||
      !/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(value.background)
    )
      throw new Error("Invalid project background");
    if (!value.materials || !value.lighting || !value.effects)
      throw new Error("Incomplete project appearance");
    for (const key of ["lightDir", "ambient", "diffuse"] as const)
      if (!Object.hasOwn(value.lighting, key))
        throw new Error(`Missing lighting.${key}`);
    for (const key of [
      "outlineEnabled",
      "atomOutline",
      "bondOutline",
      "ssao",
      "dof",
    ] as const)
      if (!Object.hasOwn(value.effects, key))
        throw new Error(`Missing effects.${key}`);
    Object.assign(this, {
      camera: {
        ...camera,
        target: [...camera.target],
        position: [...camera.position],
        up: [...camera.up],
      },
      representation: new Representation(value.representation),
      showBox: value.showBox,
      coloring: { ...value.coloring },
      materials: {
        atom: new Material(value.materials.atom),
        bond: new Material(value.materials.bond),
      },
      lighting: Settings.resolveLighting(value.lighting),
      effects: Settings.resolveEffects(value.effects),
      background: value.background,
    } satisfies ProjectViewState);
  }
}
