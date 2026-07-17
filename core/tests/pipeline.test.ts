import type { Frame } from "@molcrafts/molrs";
import { describe, expect, it } from "@rstest/core";
import type { Modifier } from "../src/pipeline/modifier";
import { ModifierCapability } from "../src/pipeline/modifier";
import { ModifierPipeline } from "../src/pipeline/pipeline";

function makeTestModifier(id: string, name = "Test Modifier"): Modifier {
  return {
    id,
    name,
    enabled: true,
    selectionScopeId: null,
    sourceOwnerId: null,
    capabilities: new Set([ModifierCapability.TransformsData]),
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

      const modifiers = pipeline.getModifiers();
      expect(modifiers.length).toBe(1);
      // ID is reassigned by addModifier to a NATO name
      expect(testModifier.id).toBe(modifiers[0].id);
    });

    it("should remove modifiers from pipeline", () => {
      const pipeline = new ModifierPipeline();

      const testModifier = makeTestModifier("test-1");

      pipeline.addModifier(testModifier);
      expect(pipeline.getModifiers().length).toBe(1);

      pipeline.removeModifier(testModifier.id); // use reassigned ID
      expect(pipeline.getModifiers().length).toBe(0);
    });

    it("should clear all modifiers", () => {
      const pipeline = new ModifierPipeline();

      const modifier1 = makeTestModifier("test-1", "Test 1");
      const modifier2 = makeTestModifier("test-2", "Test 2");

      pipeline.addModifier(modifier1);
      pipeline.addModifier(modifier2);
      expect(pipeline.getModifiers().length).toBe(2);

      pipeline.clear();
      expect(pipeline.getModifiers().length).toBe(0);
    });
  });
});
