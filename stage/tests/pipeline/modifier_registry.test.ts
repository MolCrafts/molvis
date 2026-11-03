import { describe, expect, it } from "@rstest/core";
import { MolecularSurfaceModifier } from "../../src/modifiers/MolecularSurfaceModifier";
import { DrawAtomModifier } from "../../src/pipeline/draw_atom";
import { DrawBondModifier } from "../../src/pipeline/draw_bond";
import { DrawBoxModifier } from "../../src/pipeline/draw_box";
import { DrawRibbonModifier } from "../../src/pipeline/draw_ribbon";
import { IsosurfaceModifier } from "../../src/pipeline/isosurface";
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
    expect(allNames.has(IsosurfaceModifier.NAME)).toBe(true);
    expect(allNames.has("Transparent")).toBe(true);

    expect(menuNames.has(DrawAtomModifier.NAME)).toBe(false);
    expect(menuNames.has(DrawRibbonModifier.NAME)).toBe(false);
    expect(menuNames.has(IsosurfaceModifier.NAME)).toBe(true);
    expect(menuNames.has("Transparent")).toBe(false);

    expect(menuNames.has(DrawBoxModifier.NAME)).toBe(true);
    expect(menuNames.has(DrawBondModifier.NAME)).toBe(true);
    expect(menuNames.has("Create bonds")).toBe(true);
    expect(menuNames.has("Vector field")).toBe(true);
    expect(menuNames.has("Molecular surface")).toBe(true);
    expect(menuNames.has("Draw Box")).toBe(false);
  });

  it("keeps absorbed surface names resolvable but out of the menu", () => {
    // `Gaussian density surface` and `Construct surface mesh` are now presets
    // of Molecular surface. Saved projects, backend state-sync, and RPC all
    // rebuild modifiers by registry display name, so the names must still
    // resolve — they just no longer earn their own Add-menu rows.
    ModifierRegistry.initialize();
    const all = new Set(
      ModifierRegistry.getAvailableModifiers().map((e) => e.name),
    );
    const menu = new Set(
      ModifierRegistry.getUserAddableModifiers().map((e) => e.name),
    );

    for (const legacy of [
      "Gaussian density surface",
      "Construct surface mesh",
      // The name the grid isosurface carried before the producer/draw split.
      "Create isosurface",
    ]) {
      expect(all.has(legacy)).toBe(true);
      expect(menu.has(legacy)).toBe(false);
    }
  });

  it("absorbed surface names build a Gaussian Molecular surface", () => {
    ModifierRegistry.initialize();
    const entry = ModifierRegistry.getAvailableModifiers().find(
      (e) => e.name === "Construct surface mesh",
    );
    expect(entry).toBeDefined();
    const modifier = entry?.factory() as MolecularSurfaceModifier;
    expect(modifier).toBeInstanceOf(MolecularSurfaceModifier);
    expect(modifier.algorithm).toBe("gaussian");
    // The preset is what distinguished it: a denser grid than the plain
    // Gaussian density surface.
    expect(modifier.gaussianParams.sigma).toBeCloseTo(1.2, 6);
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
      "Select from mask",
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
