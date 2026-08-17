import { describe, expect, it } from "@rstest/core";
import { DrawAtomModifier } from "../../src/pipeline/draw_atom";
import { DrawBondModifier } from "../../src/pipeline/draw_bond";
import { DrawBoxModifier } from "../../src/pipeline/draw_box";
import { DrawIsosurfaceModifier } from "../../src/pipeline/draw_isosurface";
import { DrawRibbonModifier } from "../../src/pipeline/draw_ribbon";
import {
  MODIFIER_CATEGORIES,
  ModifierRegistry,
} from "../../src/pipeline/modifier_registry";

describe("ModifierRegistry — OVITO-aligned menu", () => {
  it("exposes the six OVITO Add-menu categories (no Python)", () => {
    expect([...MODIFIER_CATEGORIES]).toEqual([
      "Selection",
      "Modification",
      "Coloring",
      "Structure identification",
      "Visualization",
      "Analysis",
    ]);
  });

  it("registers defaults once and exposes user-addable subset", () => {
    ModifierRegistry.initialize();

    const all = ModifierRegistry.getAvailableModifiers();
    const menu = ModifierRegistry.getUserAddableModifiers();

    const allNames = new Set(all.map((e) => e.name));
    const menuNames = new Set(menu.map((e) => e.name));

    expect(allNames.has(DrawAtomModifier.NAME)).toBe(true);
    expect(allNames.has(DrawRibbonModifier.NAME)).toBe(true);
    expect(allNames.has(DrawIsosurfaceModifier.NAME)).toBe(true);
    expect(allNames.has("Transparent")).toBe(true);

    expect(menuNames.has(DrawAtomModifier.NAME)).toBe(false);
    expect(menuNames.has(DrawRibbonModifier.NAME)).toBe(false);
    expect(menuNames.has(DrawIsosurfaceModifier.NAME)).toBe(true);
    expect(menuNames.has("Transparent")).toBe(false);

    expect(menuNames.has(DrawBoxModifier.NAME)).toBe(true);
    expect(menuNames.has(DrawBondModifier.NAME)).toBe(true);
    expect(menuNames.has("Create bonds")).toBe(true);
    expect(menuNames.has("Vector field")).toBe(true);
    expect(menuNames.has("Gaussian density surface")).toBe(true);
    expect(menuNames.has("Draw Box")).toBe(false);
  });

  it("places selection ops under Selection", () => {
    ModifierRegistry.initialize();
    const selection = ModifierRegistry.getUserAddableModifiers()
      .filter((e) => e.category === "Selection")
      .map((e) => e.name)
      .sort();
    expect(selection).toEqual([
      "Clear Selection",
      "Expand Selection",
      "Expression Select",
      "Hide Selection",
      "Invert Selection",
      "Select Type",
      "Select overlapping",
    ]);
  });

  it("uses full OVITO categories for menu entries", () => {
    ModifierRegistry.initialize();
    const byName = new Map(
      ModifierRegistry.getUserAddableModifiers().map((e) => [
        e.name,
        e.category,
      ]),
    );

    expect(byName.get("Expression Select")).toBe("Selection");
    expect(byName.get("Select overlapping")).toBe("Selection");
    expect(byName.get("Slice")).toBe("Modification");
    expect(byName.get("Compute property")).toBe("Modification");
    expect(byName.get("Color by Property")).toBe("Coloring");
    expect(byName.get("Assign Color")).toBe("Coloring");
    expect(byName.get("Steinhardt order")).toBe("Structure identification");
    expect(byName.get("Solid-liquid")).toBe("Structure identification");
    expect(byName.get("Create bonds")).toBe("Visualization");
    expect(byName.get(DrawBoxModifier.NAME)).toBe("Visualization");
    expect(byName.get("Coordination polyhedra")).toBe("Visualization");
    expect(byName.get("Displacement vectors")).toBe("Analysis");
  });

  it("every user-addable entry uses a known OVITO category", () => {
    ModifierRegistry.initialize();
    const allowed = new Set<string>(MODIFIER_CATEGORIES);
    for (const e of ModifierRegistry.getUserAddableModifiers()) {
      expect(allowed.has(e.category)).toBe(true);
    }
  });
});
