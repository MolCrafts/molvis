import { describe, expect, it } from "@rstest/core";
import { shouldDrawBox } from "../../src/io/box_presence";
import { loadTextTrajectory } from "../../src/io/reader";
import { DrawRibbonModifier } from "../../src/pipeline/draw_ribbon";
import "../setup_wasm";

/**
 * Mirrors 9Y9F.cif: protein backbone + cryo-EM placeholder cell
 * `_cell.length_* = 1.00`. That cell must not count as usable (ribbon
 * MI logic would fragment every CA–CA pair).
 */
const MMCIF_EM_PLACEHOLDER_CELL = `data_test
_cell.length_a  1.00
_cell.length_b  1.00
_cell.length_c  1.00
_cell.angle_alpha  90.00
_cell.angle_beta   90.00
_cell.angle_gamma  90.00
loop_
_atom_site.group_PDB
_atom_site.id
_atom_site.type_symbol
_atom_site.label_atom_id
_atom_site.label_comp_id
_atom_site.label_asym_id
_atom_site.label_seq_id
_atom_site.Cartn_x
_atom_site.Cartn_y
_atom_site.Cartn_z
_atom_site.occupancy
_atom_site.B_iso_or_equiv
_atom_site.pdbx_PDB_model_num
ATOM 1 N N  SER A 1 0.0 0.0 0.0 1.0 20.0 1
ATOM 2 C CA SER A 1 1.5 0.0 0.0 1.0 20.0 1
ATOM 3 C C  SER A 1 2.0 1.5 0.0 1.0 20.0 1
ATOM 4 O O  SER A 1 1.5 2.5 0.0 1.0 20.0 1
ATOM 5 N N  ALA A 2 3.0 1.5 0.0 1.0 20.0 1
ATOM 6 C CA ALA A 2 4.5 1.5 0.0 1.0 20.0 1
ATOM 7 C C  ALA A 2 5.0 0.0 0.0 1.0 20.0 1
ATOM 8 O O  ALA A 2 4.5 -1.0 0.0 1.0 20.0 1
ATOM 9 N N  GLY A 3 6.0 0.0 0.0 1.0 20.0 1
ATOM 10 C CA GLY A 3 7.5 0.0 0.0 1.0 20.0 1
`;

describe("EM mmCIF 1×1×1 cell + ribbon", () => {
  it("is a protein frame, strips the 1Å cell, and still matches ribbon", () => {
    const bundle = loadTextTrajectory(
      MMCIF_EM_PLACEHOLDER_CELL,
      "9y9f_like.cif",
    );
    try {
      const frame = bundle.trajectory.get(0)!;
      expect(DrawRibbonModifier.isProteinFrame(frame)).toBe(true);
      // 1×1×1 stays on the frame (modifier can attach) but is not usable
      // for PBC/MI — ribbon must not treat it as a real cell.
      expect(frame.box).toBeDefined();
      expect(shouldDrawBox(frame.box)).toBe(false);
      expect(new DrawRibbonModifier().matches(frame)).toBe(true);
    } finally {
      bundle.dispose();
    }
  });
});
