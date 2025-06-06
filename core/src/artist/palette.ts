import chroma from 'chroma-js';

class BasePalette {
  style: string;
  color: string[];
  constructor(style:chroma.BrewerPaletteName = "Set1", ncolors = 9) {
    this.style = style;
    this.color = this.setStyle(style, ncolors);
  }
  protected setStyle(newStyle: chroma.BrewerPaletteName, ncolors: number) {
    this.style = newStyle;
    this.color = chroma.scale(newStyle as chroma.BrewerPaletteName).colors(ncolors);
    return this.color;
  }
  public getAtomColor(input: string) {
    const index = input.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    return this.color[index % this.color.length];
  }
}

class RealAtomPalette extends BasePalette {
  element_radius: { [key: string]: number };
  constructor(style: chroma.BrewerPaletteName = "Set1") {
    super(style, 118);
    this.element_radius = {
      undefined: 1.0,
      H: 0.38,
      He: 0.32,
      Li: 1.34,
      Be: 0.9,
      B: 0.82,
      C: 0.77,
      N: 0.75,
      O: 0.73,
      F: 0.71,
      Ne: 0.69,
      Na: 1.54,
      Mg: 1.3,
      Al: 1.18,
      Si: 1.11,
      P: 1.06,
      S: 1.02,
      Cl: 0.99,
      Ar: 0.97,
      K: 1.96,
      Ca: 1.74,
      Sc: 1.44,
      Ti: 1.32,
      V: 1.22,
      Cr: 1.18,
      Mn: 1.17,
      Fe: 1.17,
      Co: 1.16,
      Ni: 1.15,
      Cu: 1.17,
      Zn: 1.25,
      Ga: 1.26,
      Ge: 1.22,
      As: 1.19,
      Se: 1.2,
      Br: 1.2,
      Kr: 1.16,
      Rb: 2.1,
      Sr: 1.85,
      Y: 1.63,
      Zr: 1.54,
      Nb: 1.47,
      Mo: 1.38,
      Tc: 1.28,
      Ru: 1.25,
      Rh: 1.25,
      Pd: 1.2,
      Ag: 1.28,
      Cd: 1.36,
      In: 1.42,
      Sn: 1.4,
      Sb: 1.4,
      Te: 1.36,
      I: 1.33,
      Xe: 1.31,
      Cs: 2.25,
      Ba: 1.98,
      La: 1.69,
      Ce: 1.65,
      Pr: 1.65,
      Nd: 1.64,
      Pm: 1.63,
    };
  }
  public getAtomRadius(elem_or_type: string) {
    return this.element_radius[elem_or_type] || 1.0;
  }
}

const realAtomPalette = new RealAtomPalette();

export { realAtomPalette };
