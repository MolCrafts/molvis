import { describe, expect, it } from "@rstest/core";
import { ExpandSelectionModifier } from "../../src/modifiers/ExpandSelectionModifier";
import { ExpressionSelectionModifier } from "../../src/modifiers/ExpressionSelectionModifier";
import { InvertSelectionModifier } from "../../src/modifiers/InvertSelectionModifier";
import { SelectTypeModifier } from "../../src/modifiers/SelectTypeModifier";
import { SliceModifier } from "../../src/modifiers/SliceModifier";
import { isSelectionProducer } from "../../src/pipeline/nato_ids";

describe("isSelectionProducer", () => {
  it("recognizes Expression Select, Invert, Expand, Select Type", () => {
    expect(
      isSelectionProducer(
        new ExpressionSelectionModifier("a", "element == 'C'"),
      ),
    ).toBe(true);
    expect(isSelectionProducer(new InvertSelectionModifier("b"))).toBe(true);
    expect(isSelectionProducer(new ExpandSelectionModifier("c"))).toBe(true);
    expect(isSelectionProducer(new SelectTypeModifier("d"))).toBe(true);
  });

  it("rejects pure transform modifiers", () => {
    expect(isSelectionProducer(new SliceModifier())).toBe(false);
  });
});
