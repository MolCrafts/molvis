import { describe, expect, it } from "@rstest/core";
import {
  defaultCanvasTheme,
  SKETCH_CSS_VARS,
  SKETCH_TOKEN_DEFAULTS,
} from "../../src/style/tokens";
import {
  cssColorToHex,
  readCanvasThemeFromHost,
  readCustomDefaultFromHost,
  resolveCssColor,
} from "../../src/ui/theme_bridge";

describe("theme_bridge / tokens", () => {
  it("token defaults are the only UI hex source (no legacy blue)", () => {
    expect(SKETCH_TOKEN_DEFAULTS.activeInk).toBe("#007d7e");
    expect(SKETCH_TOKEN_DEFAULTS.customDefault).toBe(
      SKETCH_TOKEN_DEFAULTS.activeInk,
    );
    expect(defaultCanvasTheme().selectionStroke).toBe(
      SKETCH_TOKEN_DEFAULTS.activeInk,
    );
  });

  it("cssColorToHex normalizes rgb and hex", () => {
    expect(cssColorToHex("#007d7e")).toBe("#007d7e");
    expect(cssColorToHex("#07e")).toBe("#0077ee");
    expect(cssColorToHex("rgb(0, 125, 126)")).toBe("#007d7e");
    expect(cssColorToHex("rgba(0, 125, 126, 0.5)")).toBe("#007d7e");
  });

  it("resolveCssColor reads --msk-active-ink from the host", () => {
    const host = document.createElement("div");
    host.style.setProperty(SKETCH_CSS_VARS.activeInk, "#007d7e");
    document.body.append(host);
    try {
      const color = resolveCssColor(host, SKETCH_CSS_VARS.activeInk, "#000000");
      expect(color).toMatch(/rgb\(|#007d7e/i);
      expect(color).not.toBe("#000000");
    } finally {
      host.remove();
    }
  });

  it("readCanvasThemeFromHost maps all four canvas fields from tokens", () => {
    const host = document.createElement("div");
    host.style.setProperty(SKETCH_CSS_VARS.stageBg, "#112233");
    host.style.setProperty(SKETCH_CSS_VARS.ink, "#abcdef");
    host.style.setProperty(SKETCH_CSS_VARS.activeInk, "#007d7e");
    document.body.append(host);
    try {
      const theme = readCanvasThemeFromHost(host);
      expect(theme.background).toMatch(/rgb\(|#112233/i);
      expect(theme.bondStroke).toMatch(/rgb\(|#abcdef/i);
      expect(theme.labelFill).toBe(theme.bondStroke);
      expect(theme.selectionStroke).toMatch(/rgb\(|#007d7e/i);
    } finally {
      host.remove();
    }
  });

  it("readCustomDefaultFromHost derives hex from active-ink", () => {
    const host = document.createElement("div");
    host.style.setProperty(SKETCH_CSS_VARS.activeInk, "#007d7e");
    document.body.append(host);
    try {
      expect(readCustomDefaultFromHost(host)).toBe("#007d7e");
    } finally {
      host.remove();
    }
  });
});
