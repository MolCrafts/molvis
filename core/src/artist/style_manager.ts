import { Color3, type Scene, StandardMaterial } from "@babylonjs/core";
import { VividTheme } from "./presets/vivid";
import { BALL_AND_STICK, type RepresentationStyle } from "./representation";
import type { AtomStyle, BondStyle, Theme } from "./theme";

export class StyleManager {
  private currentTheme: Theme;
  private scene: Scene;
  private materialCache: Map<string, StandardMaterial> = new Map();

  private _representation: RepresentationStyle = BALL_AND_STICK;

  // Simulation-box visibility. Persistent across redraws: the box mesh is
  // recreated on every full draw, so a transient mesh.setEnabled() would not
  // survive a re-render. DrawFrameCommand / app consult this before drawing.
  private _showBox = true;
  // Box edge thickness multiplier. Persisted here (not just on the mesh)
  // because DrawBoxCommand recreates the sim_box mesh on every full draw —
  // a value stored only on the mesh would reset to 1.0 on the next redraw.
  private _boxThicknessScale = 1.0;

  constructor(scene: Scene) {
    this.scene = scene;
    this.currentTheme = new VividTheme();
  }

  public setTheme(theme: Theme) {
    this.currentTheme = theme;
    this.materialCache.clear();
  }

  public setRepresentation(repr: RepresentationStyle) {
    this._representation = repr;
  }

  public getRepresentation(): RepresentationStyle {
    return this._representation;
  }

  public setAtomRadiusScale(scale: number) {
    this._representation = {
      ...this._representation,
      atomRadiusScale: scale,
      name: "Custom",
    };
  }

  public setBondRadiusScale(scale: number) {
    this._representation = {
      ...this._representation,
      bondRadiusScale: scale,
      name: "Custom",
    };
  }

  public setShowAtoms(show: boolean) {
    this._representation = {
      ...this._representation,
      showAtoms: show,
      name: "Custom",
    };
  }

  public setShowBonds(show: boolean) {
    this._representation = {
      ...this._representation,
      showBonds: show,
      name: "Custom",
    };
  }

  public setShowBox(show: boolean) {
    this._showBox = show;
  }

  public getShowBox(): boolean {
    return this._showBox;
  }

  public setBoxThicknessScale(scale: number) {
    this._boxThicknessScale = scale;
  }

  public getBoxThicknessScale(): number {
    return this._boxThicknessScale;
  }

  public getAtomRadiusScale(): number {
    return this._representation.atomRadiusScale;
  }

  public getBondRadiusScale(): number {
    return this._representation.bondRadiusScale;
  }

  public getTheme(): Theme {
    return this.currentTheme;
  }

  public getAtomStyle(element: string): AtomStyle {
    const normalized = normalizeElement(element);
    const style = this.currentTheme.getAtomStyle(normalized);
    return {
      ...style,
      radius: style.radius * this._representation.atomRadiusScale,
    };
  }

  public getTypeStyle(type: string): AtomStyle {
    const style = this.currentTheme.getTypeStyle(type);
    return {
      ...style,
      radius: style.radius * this._representation.atomRadiusScale,
    };
  }

  public getBondStyle(order: number): BondStyle {
    const style = this.currentTheme.getBondStyle(order);
    return {
      ...style,
      radius: style.radius * this._representation.bondRadiusScale,
    };
  }

  public getAtomMaterial(element: string): StandardMaterial {
    const normalized = normalizeElement(element);
    const key = `atom_${normalized}_${this.currentTheme.name}`;
    const cached = this.materialCache.get(key);
    if (cached) return cached;

    const style = this.currentTheme.getAtomStyle(normalized);
    const mat = new StandardMaterial(key, this.scene);
    mat.diffuseColor = Color3.FromHexString(style.color);

    if (style.specularColor) {
      mat.specularColor = Color3.FromHexString(style.specularColor);
    } else {
      mat.specularColor = Color3.FromHexString(
        this.currentTheme.defaultSpecular,
      );
    }

    if (style.emissiveColor) {
      mat.emissiveColor = Color3.FromHexString(style.emissiveColor);
    }

    if (style.alpha !== undefined) {
      mat.alpha = style.alpha;
    }

    this.materialCache.set(key, mat);
    return mat;
  }

  public getBondMaterial(order: number): StandardMaterial {
    const key = `bond_${order}_${this.currentTheme.name}`;
    const cached = this.materialCache.get(key);
    if (cached) return cached;

    const style = this.currentTheme.getBondStyle(order);
    const mat = new StandardMaterial(key, this.scene);
    mat.diffuseColor = Color3.FromHexString(style.color);

    if (style.specularColor) {
      mat.specularColor = Color3.FromHexString(style.specularColor);
    } else {
      mat.specularColor = Color3.FromHexString(
        this.currentTheme.defaultSpecular,
      );
    }

    if (style.alpha !== undefined) {
      mat.alpha = style.alpha;
    }

    this.materialCache.set(key, mat);
    return mat;
  }

  public getBoxMaterial(): StandardMaterial {
    const key = `box_${this.currentTheme.name}`;
    const cached = this.materialCache.get(key);
    if (cached) return cached;

    const mat = new StandardMaterial(key, this.scene);
    mat.diffuseColor = Color3.FromHexString(this.currentTheme.boxColor);

    this.materialCache.set(key, mat);
    return mat;
  }
}

/**
 * Normalize element symbol to standard form: first letter uppercase, rest lowercase.
 * Handles aromatic SMILES notation (e.g. "c" → "C", "si" → "Si").
 */
function normalizeElement(element: string): string {
  if (element.length === 0) return element;
  return element[0].toUpperCase() + element.slice(1).toLowerCase();
}
