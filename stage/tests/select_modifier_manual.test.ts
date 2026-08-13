import { describe, expect, it } from "@rstest/core";
import { SelectModifier } from "../src/modifiers/SelectModifier";

describe("SelectModifier manual selection", () => {
  it("isManual for index-backed sources", () => {
    const mod = new SelectModifier("Alpha", [1, 2, 3], "replace", [10]);
    expect(mod.isManual).toBe(true);
    expect(mod.selectedBondIds).toEqual([10]);
    expect(mod.selectionSummary).toContain("3 atoms");
  });

  it("is not manual for expression sources", () => {
    const mod = new SelectModifier("Bravo", "element == 'C'");
    expect(mod.isManual).toBe(false);
  });

  it("setManualSelection converts expression to indices and sorts", () => {
    const mod = new SelectModifier("Charlie", "element == 'C'");
    mod.setManualSelection([3, 1, 2], [9, 4]);
    expect(mod.isManual).toBe(true);
    expect(mod.selectionSource).toEqual([1, 2, 3]);
    expect([...mod.selectedBondIds]).toEqual([4, 9]);
    expect(mod.selectionSummary).toBe("3 atoms · 2 bonds");
  });

  it("empty manual summary is empty", () => {
    const mod = new SelectModifier("Delta", [], "replace", []);
    expect(mod.selectionSummary).toBe("empty");
  });
});
