import { describe, expect, it } from "@rstest/core";
import { PlaceFragmentCommand } from "../../src/commands/place_fragment_command";
import { getFragmentTemplate } from "../../src/geometry/fragment_templates";
import { MoleculeGraph } from "../../src/molecule_graph";

describe("PlaceFragmentCommand", () => {
  it("places OH free at the given point", () => {
    const graph = new MoleculeGraph();
    const template = getFragmentTemplate("oh")!;
    const cmd = new PlaceFragmentCommand(graph, template, { x: 2, y: 3 });
    cmd.do();
    const data = graph.getMoleculeData();
    expect(data.atoms).toHaveLength(2);
    expect(data.atoms[0].element).toBe("O");
    expect(data.atoms[0].x).toBeCloseTo(2, 6);
    expect(data.atoms[0].y).toBeCloseTo(3, 6);
    expect(data.bonds).toHaveLength(1);
    cmd.undo();
    expect(graph.getMoleculeData()).toEqual({ atoms: [], bonds: [] });
  });

  it("bond-attaches OH to an existing atom", () => {
    const graph = new MoleculeGraph();
    graph.loadMoleculeData({
      atoms: [{ element: "C", x: 0, y: 0 }],
      bonds: [],
    });
    const template = getFragmentTemplate("oh")!;
    new PlaceFragmentCommand(graph, template, {
      x: 0,
      y: 0,
      targetAtom: 0,
      bondDir: { x: 1, y: 0 },
    }).do();
    const data = graph.getMoleculeData();
    expect(data.atoms.map((a) => a.element)).toEqual(["C", "O", "H"]);
    expect(data.bonds).toHaveLength(2);
    expect(data.bonds.some((b) => b.i === 0 && b.j === 1)).toBe(true);
  });

  it("merge-attaches phenyl so root carbon is not duplicated", () => {
    const graph = new MoleculeGraph();
    graph.loadMoleculeData({
      atoms: [{ element: "C", x: 0, y: 0 }],
      bonds: [],
    });
    const template = getFragmentTemplate("phenyl")!;
    new PlaceFragmentCommand(graph, template, {
      x: 0,
      y: 0,
      targetAtom: 0,
    }).do();
    const data = graph.getMoleculeData();
    // 1 existing + 5 new ring carbons
    expect(data.atoms).toHaveLength(6);
    expect(data.bonds.length).toBeGreaterThanOrEqual(6);
  });
});
