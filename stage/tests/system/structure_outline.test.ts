import { Block, Frame } from "@molcrafts/molvis-core/molrs";
import { describe, expect, it } from "@rstest/core";
import "../setup_wasm";
import { buildStructureOutline } from "../../src/system/structure_outline";

describe("buildStructureOutline", () => {
  it("builds chain → residue → atom when columns exist", () => {
    const frame = new Frame();
    const atoms = new Block();
    atoms.setColF("x", new Float64Array([0, 1, 2]));
    atoms.setColF("y", new Float64Array([0, 0, 0]));
    atoms.setColF("z", new Float64Array([0, 0, 0]));
    atoms.setColStr("element", ["N", "CA", "C"]);
    atoms.setColStr("name", ["N", "CA", "C"]);
    atoms.setColStr("chain_id", ["A", "A", "A"]);
    atoms.setColF("res_seq", new Float64Array([1, 1, 1]));
    atoms.setColStr("res_name", ["ALA", "ALA", "ALA"]);
    frame.insertBlock("atoms", atoms);

    const outline = buildStructureOutline(frame);
    expect(outline.roots).toHaveLength(1);
    expect(outline.roots[0].kind).toBe("chain");
    expect(outline.roots[0].label).toContain("A");
    expect(outline.roots[0].children).toHaveLength(1);
    expect(outline.roots[0].children?.[0].kind).toBe("residue");
    expect(outline.roots[0].atomIndices).toEqual([0, 1, 2]);
  });

  it("returns empty roots for empty frame", () => {
    expect(buildStructureOutline(new Frame()).roots).toEqual([]);
  });
});
