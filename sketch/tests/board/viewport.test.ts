import { describe, expect, it } from "@rstest/core";
import {
  DEFAULT_BOND_SCREEN_PX,
  MAX_SCALE,
  ViewportCoords,
} from "../../src/board/coords";
import { ViewportController } from "../../src/board/viewport";

describe("ViewportController", () => {
  it("zoomAtScreen keeps world point under cursor fixed", () => {
    const coords = new ViewportCoords();
    coords.resize(200, 200, 1);
    coords.setScale(DEFAULT_BOND_SCREEN_PX);
    coords.setPan(0, 0);
    const ctrl = new ViewportController(coords);
    const sx = 100;
    const sy = 100;
    const before = coords.screenToDoc(sx, sy);
    ctrl.zoomAtScreen(sx, sy, 1.2);
    const after = coords.screenToDoc(sx, sy);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });

  it("fitToAtoms does not blow a single hexagon past MAX_SCALE", () => {
    const coords = new ViewportCoords();
    // Tiny sidebar canvas where old fit would use scale > 100
    coords.resize(280, 220, 1);
    const ctrl = new ViewportController(coords);
    // Regular hexagon with bond length 1, R = 1
    const atoms = Array.from({ length: 6 }, (_, i) => {
      const ang = -Math.PI / 2 + (i * 2 * Math.PI) / 6;
      return { x: Math.cos(ang), y: Math.sin(ang) };
    });
    ctrl.fitToAtoms(atoms);
    expect(coords.getScale()).toBeLessThanOrEqual(MAX_SCALE);
    expect(coords.getScale()).toBeLessThanOrEqual(DEFAULT_BOND_SCREEN_PX);
  });
});
