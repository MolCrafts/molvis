import { describe, expect, it } from "@rstest/core";
import { categoricalColorAt, getColorMap } from "../../../src/artist/palette";
import {
  chainColor,
  DEFAULT_RIBBON_STYLE,
  spectrumColor,
  ssColor,
} from "../../../src/artist/ribbon/ribbon_style";

describe("ribbon_style palette alignment", () => {
  it("defaults to chain coloring (multi-chain figures)", () => {
    expect(DEFAULT_RIBBON_STYLE.colorMode).toBe("chain");
    expect(DEFAULT_RIBBON_STYLE.widthScale).toBe(0.95);
  });

  it("uses PyMOL-like SS hex defaults (display/sRGB)", () => {
    expect(ssColor("helix")).toEqual([229 / 255, 83 / 255, 61 / 255]);
    expect(ssColor("sheet")).toEqual([240 / 255, 196 / 255, 25 / 255]);
    expect(ssColor("coil")).toEqual([125 / 255, 206 / 255, 122 / 255]);
    expect(
      ssColor("helix", { ...DEFAULT_RIBBON_STYLE, helixColor: [0, 1, 0] }),
    ).toEqual([0, 1, 0]);
  });

  it("uses categorical ordinals for chain colors (display/sRGB)", () => {
    expect(chainColor(0)).not.toEqual(chainColor(1));
    expect(chainColor(0)).not.toEqual(categoricalColorAt(0));
  });

  it("samples viridis for spectrum coloring (display/sRGB)", () => {
    const viridis = getColorMap("viridis");
    expect(spectrumColor(0)).not.toEqual(viridis.sample(0));
    expect(spectrumColor(0)).not.toEqual(spectrumColor(1));
  });

  it("uses coil palette color as the uniform default", () => {
    expect([...DEFAULT_RIBBON_STYLE.uniformColor]).toEqual(ssColor("coil"));
  });
});
