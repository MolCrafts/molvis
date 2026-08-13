import { describe, expect, it } from "@rstest/core";
import { MolvisApp } from "../src/app";
import { WrapPBCModifier } from "../src/modifiers/WrapPBCModifier";
import { DrawAtomModifier } from "../src/pipeline/draw_atom";
import { DrawBoxModifier } from "../src/pipeline/draw_box";
import { DrawRibbonModifier } from "../src/pipeline/draw_ribbon";
import { ModifierCapability } from "../src/pipeline/modifier";

describe("MolvisApp.resolvePipelineChangeKind", () => {
  it("treats omitted options as a full rebuild", () => {
    expect(MolvisApp.resolvePipelineChangeKind()).toBe("full");
    expect(MolvisApp.resolvePipelineChangeKind({})).toBe("full");
    expect(MolvisApp.resolvePipelineChangeKind({ fullRebuild: true })).toBe(
      "full",
    );
  });

  it("honors fullRebuild: false as a position pass", () => {
    expect(MolvisApp.resolvePipelineChangeKind({ fullRebuild: false })).toBe(
      "position",
    );
  });

  it("lets changeKind win over fullRebuild", () => {
    expect(
      MolvisApp.resolvePipelineChangeKind({
        fullRebuild: false,
        changeKind: "full",
      }),
    ).toBe("full");
    expect(
      MolvisApp.resolvePipelineChangeKind({
        fullRebuild: true,
        changeKind: "position",
      }),
    ).toBe("position");
  });
});

describe("MolvisApp.modifierToggleIsVisibilityOnly", () => {
  it("is true for pure visual layers", () => {
    expect(
      MolvisApp.modifierToggleIsVisibilityOnly(new DrawAtomModifier()),
    ).toBe(true);
    expect(
      MolvisApp.modifierToggleIsVisibilityOnly(new DrawBoxModifier()),
    ).toBe(true);
    // Ribbon is Draws (+ Transforms for its own residues block) — still
    // visibility-only for checkbox toggles.
    expect(
      MolvisApp.modifierToggleIsVisibilityOnly(new DrawRibbonModifier()),
    ).toBe(true);
  });

  it("is false for data transforms that rewrite the frame", () => {
    expect(
      MolvisApp.modifierToggleIsVisibilityOnly(
        new WrapPBCModifier("wrap-test"),
      ),
    ).toBe(false);
  });

  it("is false without Draws", () => {
    expect(
      MolvisApp.modifierToggleIsVisibilityOnly({
        capabilities: new Set([ModifierCapability.TransformsData]),
      }),
    ).toBe(false);
  });
});
