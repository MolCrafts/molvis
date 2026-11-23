import { expect, it } from "@rstest/core";
import type { MolvisApp } from "../../src/app";
import type { MaterialStyle } from "../../src/artist/material";
import { SetMaterialCommand } from "../../src/commands/material";

it("updates only the target surface and restores it without touching geometry", () => {
  let atom: MaterialStyle = { shading: "lit", specular: 0.1, specularPower: 4 };
  const bond = {
    shading: "illustrative",
    specular: 0,
    specularPower: 4,
  } as const;
  let renders = 0;
  const app = {
    styleManager: {
      getMaterial: (target: string) => (target === "atom" ? atom : bond),
      setMaterial: (target: string, value: MaterialStyle) => {
        expect(target).toBe("atom");
        atom = value;
      },
    },
    world: {
      renderOnce: () => {
        renders++;
      },
    },
    events: { emit() {} },
    applyPipeline: () => {
      throw new Error("material rebuilt geometry");
    },
    artist: new Proxy(
      {},
      {
        get() {
          throw new Error("material touched buffers");
        },
      },
    ),
  } as unknown as MolvisApp;
  const command = new SetMaterialCommand(app, "atom", { preset: "glossy" });
  command.do();
  expect(atom.specularPower).toBe(32);
  command.undo();
  expect(atom.specular).toBe(0.1);
  command.do();
  expect(atom.specular).toBe(0.35);
  expect(bond.shading).toBe("illustrative");
  expect(renders).toBe(3);
  expect(
    () =>
      new SetMaterialCommand(app, "atom", { preset: "glossy", specular: -1 }),
  ).toThrow();
  expect(atom.specular).toBe(0.35);
});
