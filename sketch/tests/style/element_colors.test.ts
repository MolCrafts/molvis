import { describe, expect, it } from "@rstest/core";
import {
  colorForElement,
  isLabeledElement,
  SKETCH_ELEMENT_COLORS,
} from "../../src/style/element_colors";

describe("SKETCH_ELEMENT_COLORS", () => {
  it("returns structure-formula text colors for common elements", () => {
    expect(SKETCH_ELEMENT_COLORS.C).toBe("#111111");
    expect(SKETCH_ELEMENT_COLORS.N).toBe("#0000ee");
    expect(SKETCH_ELEMENT_COLORS.O).toBe("#ee0000");
    expect(SKETCH_ELEMENT_COLORS.H).toBe("#111111");
    expect(SKETCH_ELEMENT_COLORS.F).toBe("#008000");
    expect(SKETCH_ELEMENT_COLORS.Cl).toBe("#008000");
  });

  it("unknown element falls back to dark label", () => {
    expect(colorForElement("Xx")).toBe("#111111");
  });

  it("isLabeledElement omits carbon by default", () => {
    expect(isLabeledElement("C", { omitCarbonLabel: true })).toBe(false);
    expect(isLabeledElement("O", { omitCarbonLabel: true })).toBe(true);
    expect(isLabeledElement("C", { omitCarbonLabel: true, charge: 1 })).toBe(
      true,
    );
  });
});
