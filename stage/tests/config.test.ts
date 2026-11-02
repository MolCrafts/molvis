import { describe, expect, it } from "@rstest/core";
import {
  DEFAULT_HUD_FG_DARK,
  DEFAULT_HUD_FG_LIGHT,
  defaultMolvisConfig,
  isModeEnabled,
} from "../src/config";
import { ModeType } from "../src/mode";

describe("enabled interaction modes", () => {
  it("enables every mode by default", () => {
    const config = defaultMolvisConfig();
    for (const mode of Object.values(ModeType)) {
      expect(isModeEnabled(config, mode)).toBe(true);
    }
  });

  it("blocks disabled modes and permits explicitly enabled modes", () => {
    const restricted = defaultMolvisConfig({ enabledModes: [ModeType.View] });
    expect(isModeEnabled(restricted, ModeType.View)).toBe(true);
    expect(isModeEnabled(restricted, ModeType.Edit)).toBe(false);

    const enabled = defaultMolvisConfig({
      enabledModes: [ModeType.View, ModeType.Edit],
    });
    expect(isModeEnabled(enabled, ModeType.Edit)).toBe(true);
  });
});

describe("info-panel HUD colors", () => {
  it("defaults to theme green in light and gray-white in dark", () => {
    const config = defaultMolvisConfig();
    expect(config.ui?.hud?.light).toBe(DEFAULT_HUD_FG_LIGHT);
    expect(config.ui?.hud?.dark).toBe(DEFAULT_HUD_FG_DARK);
  });

  it("keeps host overrides on ui.hud", () => {
    const config = defaultMolvisConfig({
      ui: { hud: { light: "green", dark: "silver" } },
    });
    expect(config.ui?.hud?.light).toBe("green");
    expect(config.ui?.hud?.dark).toBe("silver");
  });
});
