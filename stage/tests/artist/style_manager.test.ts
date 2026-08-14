import { NullEngine, Scene } from "@babylonjs/core";
import { describe, expect, it } from "@rstest/core";
import { OvitoStrategy } from "../../src/artist/categorical_theme";
import { ModernTheme } from "../../src/artist/presets/modern";
import { StyleManager } from "../../src/artist/style_manager";
import type { Theme } from "../../src/artist/theme";

describe("TestStyleManager", () => {
  it("defaults to ModernTheme plus tab10", () => {
    const sm = new StyleManager(new Scene(new NullEngine()));
    expect(sm.getCategoricalTheme()).toBe("tab10");
    expect(sm.getTheme().name).toBe("Modern");
    expect(sm.getAtomStyle("C").color).toBe(
      new ModernTheme().getAtomStyle("C").color,
    );
  });

  it("keeps Modern element look when switching categorical theme", () => {
    const sm = new StyleManager(new Scene(new NullEngine()));
    sm.setCategoricalTheme("ovito");
    expect(sm.getCategoricalStrategy()).toBeInstanceOf(OvitoStrategy);
    expect(sm.getTheme().name).toBe("Modern");
    expect(sm.getTypeStyle("opls_1").color).toBe("#B6BDC7");
    sm.setTheme({ name: "Classic" } as Theme);
    expect(sm.getTheme().name).toBe("Modern");
  });

  it("rejects unknown theme ids", () => {
    const sm = new StyleManager(new Scene(new NullEngine()));
    expect(() => sm.setCategoricalTheme("classic" as "tab10")).toThrow(/tab10/);
  });
});
