import chroma from "chroma-js";

class BasePalette {
  style: string;
  color: string[];
  constructor(style: chroma.BrewerPaletteName = "Set1", ncolors = 9) {
    this.style = style;
    this.color = this.setStyle(style, ncolors);
  }
  protected setStyle(newStyle: chroma.BrewerPaletteName, ncolors: number) {
    this.style = newStyle;
    this.color = chroma
      .scale(newStyle as chroma.BrewerPaletteName)
      .colors(ncolors);
    return this.color;
  }
  public getAtomColor(input: string) {
    const index = input
      .split("")
      .reduce((acc, char) => acc + char.charCodeAt(0), 0);
    return this.color[index % this.color.length];
  }
}

class RealAtomPalette extends BasePalette {
  element_radius: { [key: string]: number };
  element_color: { [key: string]: string };
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
    this.element_color = {
      H: "#FFFFFF",
      He: "#D9FFFF",
      Li: "#CC80FF",
      Be: "#C2FF00",
      B: "#FFB5B5",
      C: "#909090",
      N: "#3050F8",
      O: "#FF0D0D",
      F: "#90E050",
      Ne: "#B3E3F5",
      Na: "#AB5CF2",
      Mg: "#8AFF00",
      Al: "#BFA6A6",
      Si: "#F0C8A0",
      P: "#FF8000",
      S: "#FFFF30",
      Cl: "#1FF01F",
      Ar: "#80D1E3",
      K: "#8F40D4",
      Ca: "#3DFF00",
      Sc: "#E6E6E6",
      Ti: "#BFC2C7",
      V: "#A6A6AB",
      Cr: "#8A99C7",
      Mn: "#9C7AC7",
      Fe: "#E06633",
      Co: "#F090A0",
      Ni: "#50D050",
      Cu: "#C88033",
      Zn: "#7D80B0",
      Ga: "#C28F8F",
      Ge: "#668F8F",
      As: "#BD80E3",
      Se: "#FFA100",
      Br: "#A62929",
      Kr: "#5CB8D1",
      Rb: "#702EB0",
      Sr: "#00FF00",
      Y: "#94FFFF",
      Zr: "#94E0E0",
      Nb: "#73C2C9",
      Mo: "#54B5B5",
      Tc: "#3B9E9E",
      Ru: "#248F8F",
      Rh: "#0A7D8C",
      Pd: "#006985",
      Ag: "#C0C0C0",
      Cd: "#FFD98F",
      In: "#A67573",
      Sn: "#668080",
      Sb: "#9E63B5",
      Te: "#D47A00",
      I: "#940094",
      Xe: "#429EB0",
      Cs: "#57178F",
      Ba: "#00C900",
      La: "#70D4FF",
      Ce: "#FFFFC7",
      Pr: "#D9FFC7",
      Nd: "#C7FFC7",
      Pm: "#A3FFC7",
      Sm: "#8FFFC7",
      Eu: "#61FFC7",
      Gd: "#45FFC7",
      Tb: "#30FFC7",
      Dy: "#1FFFC7",
      Ho: "#00FF9C",
      Er: "#00E675",
      Tm: "#00D452",
      Yb: "#00BF38",
      Lu: "#00AB24",
      Hf: "#4DC2FF",
      Ta: "#4DA6FF",
      W: "#2194D6",
      Re: "#267DAB",
      Os: "#266696",
      Ir: "#175487",
      Pt: "#D0D0E0",
      Au: "#FFD123",
      Hg: "#B8B8D0",
      Tl: "#A6544D",
      Pb: "#575961",
      Bi: "#9E4FB5",
      Po: "#AB5C00",
      At: "#754F45",
      Rn: "#428296",
      Fr: "#420066",
      Ra: "#007D00",
      Ac: "#70ABFA",
      Th: "#00BAFF",
      Pa: "#00A1FF",
      U: "#008FFF",
      Np: "#0080FF",
      Pu: "#006BFF",
      Am: "#545CF2",
      Cm: "#785CE3",
      Bk: "#8A4FE3",
      Cf: "#A136D4",
      Es: "#B31FD4",
      Fm: "#B31FBA",
      Md: "#B30DA6",
      No: "#BD0D87",
      Lr: "#C70066",
      Rf: "#CC0059",
      Db: "#D1004F",
      Sg: "#D90045",
      Bh: "#E00038",
      Hs: "#E6002E",
      Mt: "#EB0026",
      Ds: "#FF1493",
      Rg: "#FF1493",
      Cn: "#FF1493",
      Fl: "#FF1493",
      Lv: "#FF1493",
      Ts: "#FF1493",
      Og: "#FF1493",
      undefined: "#CCCCCC",
    };
  }
  public getAtomRadius(elem_or_type: string) {
    return this.element_radius[elem_or_type] || 1.0;
  }
  
  // Override parent's getAtomColor to use element_color dictionary
  public getAtomColor(input: string) {
    return this.element_color[input] || this.element_color.undefined;
  }
}

const realAtomPalette = new RealAtomPalette();

export { realAtomPalette };
