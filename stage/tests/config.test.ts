import { describe, expect, it } from "@rstest/core";
import { defaultMolvisConfig, isModeEnabled } from "../src/config";
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
