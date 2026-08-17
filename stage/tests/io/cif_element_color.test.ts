import { NullEngine, Scene } from "@babylonjs/core";
import { describe, expect, it } from "@rstest/core";
import { buildAtomBuffers } from "../../src/artist/atom_buffer";
import { StyleManager } from "../../src/artist/style_manager";
import { loadTextTrajectory } from "../../src/io/reader";
import "../setup_wasm";

/** Minimal mmCIF with N/C/O so element coloring is unambiguous. */
const MMCIF = `data_test
_cell.length_a  50.0
_cell.length_b  50.0
_cell.length_c  50.0
_cell.angle_alpha  90.0
_cell.angle_beta   90.0
_cell.angle_gamma  90.0
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
ATOM 1 N N  GLY A 1 -5.0 -5.0 -5.0 1.0 20.0 1
ATOM 2 C CA GLY A 1 -4.0 -5.0 -5.0 1.0 20.0 1
ATOM 3 C C  GLY A 1 -3.0 -5.0 -5.0 1.0 20.0 1
ATOM 4 O O  GLY A 1 -2.5 -4.0 -5.0 1.0 20.0 1
`;

describe("CIF element coloring", () => {
  it("maps type_symbol to element and colors N/C/O differently", () => {
    const bundle = loadTextTrajectory(MMCIF, "test.cif");
    try {
      const frame = bundle.trajectory.get(0)!;
      const atoms = frame.getBlock("atoms");
      expect(atoms).toBeTruthy();
      const keys = typeof atoms!.keys === "function" ? atoms!.keys() : [];
      console.log("keys", keys);
      console.log("element dtype", atoms!.dtype("element"));
      console.log("type_symbol dtype", atoms!.dtype("type_symbol"));
      const el = atoms!.copyColStr("element") as string[];
      console.log("elements", el);
      expect([...el]).toEqual(["N", "C", "C", "O"]);

      const engine = new NullEngine();
      const scene = new Scene(engine);
      const sm = new StyleManager(scene);
      const buffers = buildAtomBuffers(atoms!, sm, 1);
      const color = buffers.get("instanceColor")!;
      const n = [color[0], color[1], color[2]];
      const c = [color[4], color[5], color[6]];
      const o = [color[12], color[13], color[14]];
      console.log("N color", n, "C color", c, "O color", o);

      const dist = (a: number[], b: number[]) =>
        Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
      expect(dist(n, c)).toBeGreaterThan(0.15);
      expect(dist(c, o)).toBeGreaterThan(0.15);
      expect(dist(n, o)).toBeGreaterThan(0.15);
      expect(o[0]).toBeGreaterThan(c[0]);

      scene.dispose();
      engine.dispose();
    } finally {
      bundle.dispose();
    }
  });
});
