import {
  DEFAULT_BOND_SCREEN_PX,
  MAX_SCALE,
  MIN_SCALE,
  type ViewportCoords,
} from "./coords";

/**
 * Pan/zoom helpers. Fit never blows a small molecule up past MAX_SCALE
 * (ChemDraw-like on-screen bond size).
 */
export class ViewportController {
  constructor(private readonly coords: ViewportCoords) {}

  panByScreen(dxCss: number, dyCss: number): void {
    const scale = this.coords.getScale();
    const pan = this.coords.getPan();
    this.coords.setPan(pan.x - dxCss / scale, pan.y + dyCss / scale);
  }

  zoomAtScreen(sx: number, sy: number, factor: number): void {
    const before = this.coords.screenToDoc(sx, sy);
    const next = this.coords.getScale() * factor;
    this.coords.setScale(
      Math.min(MAX_SCALE * 1.5, Math.max(MIN_SCALE * 0.5, next)),
    );
    const after = this.coords.screenToDoc(sx, sy);
    const pan = this.coords.getPan();
    this.coords.setPan(
      pan.x + (before.x - after.x),
      pan.y + (before.y - after.y),
    );
  }

  /**
   * Frame the molecule with generous margin; cap scale so benzene stays
   * roughly ~30px/bond, not wall-to-wall.
   */
  fitToAtoms(atoms: Array<{ x: number; y: number }>, paddingCss = 48): void {
    if (atoms.length === 0) {
      this.coords.setScale(DEFAULT_BOND_SCREEN_PX);
      this.coords.setPan(0, 0);
      return;
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const a of atoms) {
      minX = Math.min(minX, a.x);
      minY = Math.min(minY, a.y);
      maxX = Math.max(maxX, a.x);
      maxY = Math.max(maxY, a.y);
    }
    // Pad by half a bond so labels/halos aren't clipped
    minX -= 0.5;
    minY -= 0.5;
    maxX += 0.5;
    maxY += 0.5;

    const { width, height } = this.coords.getCssSize();
    const dx = Math.max(maxX - minX, 1e-3);
    const dy = Math.max(maxY - minY, 1e-3);
    // Aim for ~55% of the short axis (not 100%) so rings look small on paper
    const usableW = Math.max(1, width - 2 * paddingCss) * 0.55;
    const usableH = Math.max(1, height - 2 * paddingCss) * 0.55;
    const fitted = Math.min(usableW / dx, usableH / dy);
    const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, fitted));
    // Prefer default bond screen size when molecule is tiny
    this.coords.setScale(Math.min(scale, DEFAULT_BOND_SCREEN_PX));
    this.coords.setPan((minX + maxX) / 2, (minY + maxY) / 2);
  }
}
