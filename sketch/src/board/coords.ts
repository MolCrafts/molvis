/**
 * Screen (CSS px relative to canvas) ↔ document (bond-length units) coordinates.
 *
 * Scale convention (ChemDraw / Ketcher-like on screen):
 * one bond-length unit ≈ {@link DEFAULT_BOND_SCREEN_PX} CSS pixels.
 */

/** Target on-screen bond length (px). Typical paper sketchers ~28–32px. */
export const DEFAULT_BOND_SCREEN_PX = 30;

/** Hard cap so a lone ring never fills the whole panel after fit. */
export const MAX_SCALE = 36;

/** Floor so tiny molecules stay clickable. */
export const MIN_SCALE = 16;

/**
 * Screen (CSS px relative to canvas) ↔ document coordinates.
 */
export class ViewportCoords {
  private cssWidth = 1;
  private cssHeight = 1;
  private dpr = 1;
  private panX = 0;
  private panY = 0;
  /** CSS pixels per document unit. */
  private scale = DEFAULT_BOND_SCREEN_PX;

  resize(cssWidth: number, cssHeight: number, dpr: number): void {
    this.cssWidth = Math.max(1, cssWidth);
    this.cssHeight = Math.max(1, cssHeight);
    this.dpr = Math.max(1e-6, dpr);
  }

  getCssSize(): { width: number; height: number } {
    return { width: this.cssWidth, height: this.cssHeight };
  }

  getDpr(): number {
    return this.dpr;
  }

  getBackingStoreSize(): { width: number; height: number } {
    return {
      width: Math.round(this.cssWidth * this.dpr),
      height: Math.round(this.cssHeight * this.dpr),
    };
  }

  setPan(x: number, y: number): void {
    this.panX = x;
    this.panY = y;
  }

  getPan(): { x: number; y: number } {
    return { x: this.panX, y: this.panY };
  }

  setScale(scale: number): void {
    this.scale = Math.max(1e-6, scale);
  }

  getScale(): number {
    return this.scale;
  }

  screenToDoc(sx: number, sy: number): { x: number; y: number } {
    const cx = this.cssWidth / 2;
    const cy = this.cssHeight / 2;
    return {
      x: (sx - cx) / this.scale + this.panX,
      y: (cy - sy) / this.scale + this.panY,
    };
  }

  docToScreen(x: number, y: number): { x: number; y: number } {
    const cx = this.cssWidth / 2;
    const cy = this.cssHeight / 2;
    return {
      x: (x - this.panX) * this.scale + cx,
      y: cy - (y - this.panY) * this.scale,
    };
  }
}
