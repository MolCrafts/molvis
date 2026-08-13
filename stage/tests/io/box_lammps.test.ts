import { Box } from "@molcrafts/molvis-core/molrs";
import { describe, expect, it } from "@rstest/core";
import "../setup_wasm";
import { hMatrixFromLammps, lammpsCellFromBox } from "../../src/io/box_lammps";

const LENGTHS = [8, 8, 8] as const;
const TILTS = [2, 0, 0] as const;
const ORIGIN = [1, 0, 0] as const;

describe("lammpsCellFromBox", () => {
  it("round-trips an orthorhombic cell through lengths()", () => {
    const box = Box.ortho(
      Float64Array.from(LENGTHS),
      Float64Array.from(ORIGIN),
      true,
      false,
      true,
    );
    const cell = lammpsCellFromBox(box);
    expect(cell.lengths).toEqual([8, 8, 8]);
    expect(cell.tilts).toEqual([0, 0, 0]);
    expect(cell.origin).toEqual([1, 0, 0]);
    expect(cell.pbc).toEqual([true, false, true]);
  });

  it("returns the LAMMPS diagonal, not vector norms, for a tilted cell", () => {
    const h = hMatrixFromLammps(LENGTHS, TILTS);
    const box = new Box(h, Float64Array.from(ORIGIN), true, true, true);
    const cell = lammpsCellFromBox(box);

    expect(cell.lengths[0]).toBeCloseTo(8, 12);
    expect(cell.lengths[1]).toBeCloseTo(8, 12);
    expect(cell.lengths[2]).toBeCloseTo(8, 12);
    expect(cell.tilts[0]).toBeCloseTo(2, 12);
    expect(cell.tilts[1]).toBeCloseTo(0, 12);
    expect(cell.tilts[2]).toBeCloseTo(0, 12);
    expect(cell.origin).toEqual([1, 0, 0]);

    // The bug this golden exists to catch: |b| = √(xy² + ly²) ≈ 8.246.
    const norms = box.lengths().toCopy();
    expect(norms[1]).toBeGreaterThan(8.2);
    expect(cell.lengths[1]).toBeLessThan(8.01);
  });
});
