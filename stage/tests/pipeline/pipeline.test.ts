import type { Frame } from "@molcrafts/molvis-core/molrs";
import { describe, expect, it } from "@rstest/core";
import type { Modifier } from "../../src/pipeline/modifier";
import { ModifierCapability } from "../../src/pipeline/modifier";
import { executionOrder, ModifierPipeline } from "../../src/pipeline/pipeline";

function makeTestModifier(
  id: string,
  name = "Test Modifier",
  capabilities: ReadonlySet<ModifierCapability> = new Set([
    ModifierCapability.TransformsData,
  ]),
): Modifier {
  return {
    id,
    name,
    enabled: true,
    selectionScopeId: null,
    sourceOwnerId: null,
    capabilities,
    matches: () => false,
    isApplicable: () => true,
    apply: (frame: Frame) => frame,
    validate: () => ({ valid: true }),
    getCacheKey: () => `${id}:true`,
    applyVisibility: () => {},
  };
}

/**
 * Test suite for Pipeline System
 */
describe("Pipeline System", () => {
  describe("Modifier", () => {
    it("should create a modifier implementation", () => {
      const testModifier = makeTestModifier("test-1");

      expect(testModifier.id).toBe("test-1");
      expect(testModifier.name).toBe("Test Modifier");
      expect(testModifier.enabled).toBe(true);
    });

    it("should be able to enable/disable modifier", () => {
      const testModifier = makeTestModifier("test-2");

      expect(testModifier.enabled).toBe(true);

      testModifier.enabled = false;
      expect(testModifier.enabled).toBe(false);

      testModifier.enabled = true;
      expect(testModifier.enabled).toBe(true);
    });
  });

  describe("ModifierPipeline", () => {
    it("should add modifiers to pipeline", () => {
      const pipeline = new ModifierPipeline();

      const testModifier = makeTestModifier("test-1");

      pipeline.addModifier(testModifier);

      const modifiers = pipeline.getEntries();
      expect(modifiers.length).toBe(1);
      // ID is reassigned by addModifier to a NATO name
      expect(testModifier.id).toBe(modifiers[0].id);
    });

    it("should remove modifiers from pipeline", () => {
      const pipeline = new ModifierPipeline();

      const testModifier = makeTestModifier("test-1");

      pipeline.addModifier(testModifier);
      expect(pipeline.getEntries().length).toBe(1);

      pipeline.removeEntry(testModifier.id); // use reassigned ID
      expect(pipeline.getEntries().length).toBe(0);
    });

    it("should clear all modifiers", () => {
      const pipeline = new ModifierPipeline();

      const modifier1 = makeTestModifier("test-1", "Test 1");
      const modifier2 = makeTestModifier("test-2", "Test 2");

      pipeline.addModifier(modifier1);
      pipeline.addModifier(modifier2);
      expect(pipeline.getEntries().length).toBe(2);

      pipeline.clear();
      expect(pipeline.getEntries().length).toBe(0);
    });

    it("auto-inserts pure TransformsData before the first Draws modifier", () => {
      const pipeline = new ModifierPipeline();
      const draw = makeTestModifier(
        "draw",
        "Draw",
        new Set([ModifierCapability.Draws]),
      );
      const wrap = makeTestModifier(
        "wrap",
        "Wrap",
        new Set([ModifierCapability.TransformsData]),
      );
      pipeline.addModifier(draw);
      pipeline.addModifier(wrap);
      const ids = pipeline.getEntries().map((m) => m.name);
      expect(ids.indexOf("Wrap")).toBeLessThan(ids.indexOf("Draw"));
    });
  });

  describe("executionOrder", () => {
    it("runs pure transforms before draws even when listed after", () => {
      const draw = makeTestModifier(
        "draw",
        "Draw",
        new Set([ModifierCapability.Draws]),
      );
      const wrap = makeTestModifier(
        "wrap",
        "Wrap",
        new Set([ModifierCapability.TransformsData]),
      );
      const color = makeTestModifier(
        "color",
        "Color",
        new Set([ModifierCapability.TransformsData]),
      );
      // User reordered so wrap sits after draw in the array.
      const ordered = executionOrder([draw, wrap, color]);
      expect(ordered.map((m) => m.name)).toEqual(["Wrap", "Color", "Draw"]);
    });

    it("keeps dual-capability modifiers with the draws group", () => {
      const ribbon = makeTestModifier(
        "ribbon",
        "Ribbon",
        new Set([ModifierCapability.TransformsData, ModifierCapability.Draws]),
      );
      const wrap = makeTestModifier(
        "wrap",
        "Wrap",
        new Set([ModifierCapability.TransformsData]),
      );
      const ordered = executionOrder([ribbon, wrap]);
      expect(ordered.map((m) => m.name)).toEqual(["Wrap", "Ribbon"]);
    });

    it("runs manual Simulation cell before pure transforms so frame.box is set first", async () => {
      const { DrawBoxModifier } = await import("../../src/pipeline/draw_box");
      const drawBox = new DrawBoxModifier("draw-box", {
        lengths: [10, 10, 10],
        tilts: [0, 0, 0],
        origin: [0, 0, 0],
        pbc: [true, true, true],
      });
      const wrap = makeTestModifier(
        "wrap",
        "Wrap",
        new Set([ModifierCapability.TransformsData]),
      );
      const atoms = makeTestModifier(
        "atoms",
        "Particles",
        new Set([ModifierCapability.Draws]),
      );
      // UI list order: draws first, wrap last — compute must still inject box.
      const ordered = executionOrder([atoms, wrap, drawBox]);
      expect(ordered.map((m) => m.name)).toEqual([
        "Simulation cell",
        "Wrap",
        "Particles",
      ]);
    });
  });
});
