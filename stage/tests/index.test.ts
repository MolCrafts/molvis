import { describe, expect, it } from "@rstest/core";
import * as stageApi from "../src/index";

describe("TestStageIndexExports", () => {
  it("does not export ClassicTheme or VividTheme", () => {
    const exported = stageApi as Record<string, unknown>;
    expect("ClassicTheme" in exported).toBe(false);
    expect("VividTheme" in exported).toBe(false);
    expect(typeof exported.ClassicTheme).toBe("undefined");
    expect(typeof exported.VividTheme).toBe("undefined");
  });

  it("still exports ModernTheme", () => {
    expect(typeof stageApi.ModernTheme).toBe("function");
    expect(new stageApi.ModernTheme().name).toBe("Modern");
  });

  it("keeps public cpk and vivid element tables", () => {
    for (const name of ["cpk", "vivid"] as const) {
      const def = stageApi.getPaletteDefinition(name);
      expect(def.kind).toBe("element");
      expect(def.entries).toHaveLength(118);
      expect(def.entries.find((e) => e.label === "C")?.color).toBe("#909090");
      expect(def.entries.find((e) => e.label === "H")?.color).toBe("#FFFFFF");
    }
  });
});
