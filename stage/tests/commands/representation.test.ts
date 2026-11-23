import { expect, it } from "@rstest/core";
import type { MolvisApp } from "../../src/app";
import type { MaterialStyle } from "../../src/artist/material";
import { BALL_AND_STICK, SPACEFILL } from "../../src/artist/representation";
import { SetVisualStyleCommand } from "../../src/commands/representation";
import { DEFAULT_SETTING } from "../../src/settings";

function host() {
  let representation = BALL_AND_STICK;
  let color = "split";
  let effects = { ...DEFAULT_SETTING.effects };
  const materials: Record<string, MaterialStyle> = {
    atom: { shading: "lit", specular: 0.2, specularPower: 8 },
    bond: { shading: "flat", specular: 0, specularPower: 4 },
  };
  let rebuilds = 0;
  const app = {
    frame: {},
    styleManager: {
      getRepresentation: () => representation,
      setRepresentation: (value: typeof representation) => {
        representation = value;
      },
      getMaterial: (key: string) => materials[key],
      setMaterial: (key: string, value: MaterialStyle) => {
        materials[key] = value;
      },
      getBondColorMode: () => color,
      setBondColorMode: (value: string) => {
        color = value;
      },
    },
    settings: {
      getEffects: () => effects,
      setEffects: (value: Partial<typeof effects>) => {
        effects = { ...effects, ...value };
      },
    },
    world: { renderOnce() {} },
    events: { emit() {} },
    applyPipeline: async () => {
      rebuilds++;
    },
  };
  return {
    app,
    get representation() {
      return representation;
    },
    materials,
    get color() {
      return color;
    },
    get effects() {
      return effects;
    },
    get rebuilds() {
      return rebuilds;
    },
  };
}

it("keeps material on a geometry change and reverses a complete look as one edit", async () => {
  const h = host();
  const geometry = new SetVisualStyleCommand(h.app as unknown as MolvisApp, {
    representation: SPACEFILL,
  });
  await geometry.do();
  expect(h.materials.atom.specular).toBe(0.2);
  await geometry.undo();
  expect(h.representation.id).toBe("ball-and-stick");
  const command = new SetVisualStyleCommand(h.app as unknown as MolvisApp, {
    representation: SPACEFILL,
    materials: { atom: { preset: "glossy" } },
    bondColorMode: "theme",
    outline: { outlineEnabled: true, atomOutline: 0.1 },
  });
  await command.do();
  expect(h.rebuilds).toBe(3);
  expect(h.color).toBe("theme");
  expect(h.materials.atom.specularPower).toBe(32);
  await command.undo();
  expect(h.color).toBe("split");
  expect(h.effects.atomOutline).toBe(0);
  expect(h.materials.atom.specular).toBe(0.2);
  await command.do();
  expect(h.representation.id).toBe("spacefill");
  expect(h.effects.atomOutline).toBe(0.1);
});

it("restores every layer before recovering from a failed rebuild", async () => {
  const h = host();
  let attempts = 0;
  h.app.applyPipeline = async () => {
    if (++attempts === 1) throw new Error("rebuild failed");
    expect(h.representation.id).toBe("ball-and-stick");
    expect(h.color).toBe("split");
    expect(h.materials.atom.specular).toBe(0.2);
  };
  const command = new SetVisualStyleCommand(h.app as unknown as MolvisApp, {
    representation: SPACEFILL,
    materials: { atom: { preset: "glossy" } },
    bondColorMode: "theme",
  });
  await expect(command.do()).rejects.toThrow("rebuild failed");
  expect(attempts).toBe(2);
  expect(h.representation.id).toBe("ball-and-stick");
});
