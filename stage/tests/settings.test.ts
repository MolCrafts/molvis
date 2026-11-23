import { expect, it } from "@rstest/core";
import type { MolvisApp } from "../src/app";
import { defaultMolvisSettings, Settings } from "../src/settings";

it("normalizes legacy graphics effects with explicit new values taking precedence", () => {
  const defaults = defaultMolvisSettings();
  expect(defaults.effects.ssao).toBe(false);
  expect(defaults.graphics.fxaa).toBe(true);
  const input = {
    graphics: { fxaa: true, hardwareScaling: 1, ssao: true, dof: true },
    effects: { ssao: false },
  };
  const normalized = defaultMolvisSettings(
    input as unknown as Parameters<typeof defaultMolvisSettings>[0],
  );
  expect(normalized.effects.ssao).toBe(false);
  expect(normalized.effects.dof).toBe(true);
  expect(normalized.graphics).toEqual({ fxaa: true, hardwareScaling: 1 });
  expect(() =>
    defaultMolvisSettings({
      graphics: { shadows: true },
    } as unknown as Parameters<typeof defaultMolvisSettings>[0]),
  ).toThrow(/not supported/);
  expect(() =>
    defaultMolvisSettings({ graphics: { hardwareScaling: -1 } }),
  ).toThrow(/quality/);
});

it("migrates legacy highlights once and rolls back unavailable effects", () => {
  const assigned: [string, unknown][] = [];
  let fail = false;
  let stroke = 2;
  let checkStroke = false;
  const applied: boolean[] = [];
  const app = {
    styleManager: {
      setMaterial: (target: string, value: unknown) =>
        assigned.push([target, value]),
    },
    events: {
      emit(name: string, value: { outlineEnabled: boolean }) {
        if (name === "effects-change") stroke = value.outlineEnabled ? 4 : 2;
      },
    },
    world: {
      renderOnce() {
        if (checkStroke) expect(stroke).toBe(4);
      },
      applyGraphicsSettings() {},
      applyEffectsSettings: (value: { dof: boolean }) => {
        applied.push(value.dof);
        if (fail && value.dof) throw new Error("unavailable");
      },
      camera: { radius: 100, target: { length: () => 0 } },
      scene: { onBeforeRenderObservable: { add() {} } },
    },
  } as unknown as MolvisApp;
  const settings = new Settings(app, {
    lighting: {
      lightDir: [0, 0, -1],
      ambient: 0.4,
      diffuse: 0.4,
      specular: 0.7,
      specularPower: 48,
    },
  } as unknown as Parameters<typeof defaultMolvisSettings>[0]);
  expect(assigned.map(([target]) => target)).toEqual(["atom", "bond"]);
  expect(assigned[0][1]).toEqual({
    shading: "lit",
    specular: 0.7,
    specularPower: 48,
  });
  expect(settings.getLighting()).toEqual({
    lightDir: [0, 0, -1],
    ambient: 0.4,
    diffuse: 0.4,
  });
  checkStroke = true;
  settings.setEffects({ outlineEnabled: true });
  fail = true;
  expect(() => settings.setEffects({ dof: true })).toThrow("unavailable");
  expect(settings.getEffects().dof).toBe(false);
  expect(applied.slice(-2)).toEqual([true, false]);
  expect(() => settings.setLighting({ specular: 1 } as never)).toThrow(
    /lighting parameter/,
  );
});
