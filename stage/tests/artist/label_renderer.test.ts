import { describe, expect, it } from "@rstest/core";
import {
  DEFAULT_LABEL_CONFIG,
  resolveTemplate,
  skeletalLabelFontSize,
} from "../../src/artist/label_renderer";

describe("resolveTemplate", () => {
  it("should resolve {element}", () => {
    const result = resolveTemplate("{element}", 0, "C", new Map());
    expect(result).toBe("C");
  });

  it("should resolve {atomId}", () => {
    const result = resolveTemplate("{atomId}", 42, "O", new Map());
    expect(result).toBe("42");
  });

  it("should resolve {index} as alias for atomId", () => {
    const result = resolveTemplate("{index}", 7, "N", new Map());
    expect(result).toBe("7");
  });

  it("should resolve combined template", () => {
    const result = resolveTemplate("{element} #{atomId}", 3, "Fe", new Map());
    expect(result).toBe("Fe #3");
  });

  it("should resolve column values from map", () => {
    const cols = new Map([
      ["charge", "0.5"],
      ["type", "CA"],
    ]);
    const result = resolveTemplate("{type}: {charge}", 0, "C", cols);
    expect(result).toBe("CA: 0.5");
  });

  it("should return key name for unknown columns", () => {
    const result = resolveTemplate("{unknown}", 0, "C", new Map());
    expect(result).toBe("unknown");
  });

  it("should handle plain text without placeholders", () => {
    const result = resolveTemplate("hello", 0, "C", new Map());
    expect(result).toBe("hello");
  });

  it("should handle empty template", () => {
    const result = resolveTemplate("", 0, "C", new Map());
    expect(result).toBe("");
  });

  it("should handle multiple occurrences of same placeholder", () => {
    const result = resolveTemplate("{element}-{element}", 0, "O", new Map());
    expect(result).toBe("O-O");
  });
});

describe("DEFAULT_LABEL_CONFIG", () => {
  it("should have mode 'none' by default", () => {
    expect(DEFAULT_LABEL_CONFIG.mode).toBe("none");
  });

  it("should have element template by default", () => {
    expect(DEFAULT_LABEL_CONFIG.template).toBe("{element}");
  });

  it("should have maxVisible of 200", () => {
    expect(DEFAULT_LABEL_CONFIG.maxVisible).toBe(200);
  });

  it("should have readable default fontSize", () => {
    expect(DEFAULT_LABEL_CONFIG.fontSize).toBeGreaterThanOrEqual(18);
    expect(DEFAULT_LABEL_CONFIG.fontSize).toBeLessThanOrEqual(48);
  });

  it("should default to bold weight for heteroatom symbols", () => {
    expect(DEFAULT_LABEL_CONFIG.fontWeight).toBe("bold");
  });
});

describe("skeletalLabelFontSize", () => {
  it("floors at 28 for short viewports", () => {
    expect(skeletalLabelFontSize(400)).toBe(28);
  });

  it("scales with viewport height", () => {
    expect(skeletalLabelFontSize(1000)).toBe(32);
    expect(skeletalLabelFontSize(1600)).toBe(51);
  });

  it("caps at 56 for huge canvases", () => {
    expect(skeletalLabelFontSize(4000)).toBe(56);
  });
});
