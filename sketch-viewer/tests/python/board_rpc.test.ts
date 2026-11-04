import type { MoleculeData, SketchTopology } from "@molcrafts/molvis-sketch";
import { describe, expect, it } from "@rstest/core";
import {
  type RpcBoard,
  SketchBoardRpc,
  SketchRpcError,
} from "../../src/python/board_rpc";

/** Records every board call; returns canned values where the board would. */
function fakeBoard(document: MoleculeData = { atoms: [], bonds: [] }) {
  const calls: Array<[string, unknown[]]> = [];
  let data = document;
  const record =
    (name: string, result?: unknown) =>
    (...args: unknown[]) => {
      calls.push([name, args]);
      return result;
    };
  const board = {
    drawAtom: record("drawAtom", 4),
    drawBond: record("drawBond", 2),
    setFragmentTemplate: record("setFragmentTemplate"),
    placeFragmentAt: record("placeFragmentAt"),
    setRingTemplate: record("setRingTemplate"),
    placeRingAt: record("placeRingAt"),
    drawChain: record("drawChain"),
    clear: record("clear"),
    undo: record("undo"),
    redo: record("redo"),
    replaceSelectedAtoms: record("replaceSelectedAtoms"),
    selectedAtomIndices: record("selectedAtomIndices", [0, 2]),
    deleteSelection: record("deleteSelection"),
    getMoleculeData: () => data,
    loadMoleculeData: (next: MoleculeData) => {
      calls.push(["loadMoleculeData", [next]]);
      data = next;
    },
    toSvg: record("toSvg", "<svg/>"),
    toPng: (...args: unknown[]) => {
      calls.push(["toPng", args]);
      return Promise.resolve(new Blob([new Uint8Array([137, 80, 78, 71])]));
    },
    fitToView: record("fitToView"),
    getState: record("getState", { tool: "atom" }),
  } as unknown as RpcBoard;
  return { board, calls };
}

const placer = {
  place: (topology: SketchTopology): MoleculeData => ({
    atoms: topology.atoms.map((atom, k) => ({ ...atom, x: k, y: 0 })),
    bonds: topology.bonds,
  }),
};

const templates = () => [
  { id: "phenyl", category: "rings", label: "Phenyl" },
  { id: "methyl", category: "groups", label: "Methyl" },
];

describe("SketchBoardRpc", () => {
  it("draws an atom and returns its index", async () => {
    const { board, calls } = fakeBoard();
    const rpc = new SketchBoardRpc(board, placer, templates);
    await expect(
      rpc.execute("sketch.draw_atom", { element: "N", x: 1, y: 2, charge: 1 }),
    ).resolves.toBe(4);
    expect(calls).toEqual([
      ["drawAtom", [{ element: "N", x: 1, y: 2, charge: 1 }]],
    ]);
  });

  it("loads a topology through the layout and fits the view", async () => {
    const { board, calls } = fakeBoard();
    const rpc = new SketchBoardRpc(board, placer, templates);
    const result = (await rpc.execute("sketch.load", {
      data: {
        atoms: [{ element: "O", charge: -1, hydrogens: 1 }, { element: "C" }],
        bonds: [{ i: 0, j: 1, order: 1 }],
      },
    })) as MoleculeData;
    expect(result.atoms[0]).toEqual({
      element: "O",
      charge: -1,
      hydrogens: 1,
      x: 0,
      y: 0,
    });
    expect(calls.map(([name]) => name)).toEqual([
      "loadMoleculeData",
      "fitToView",
    ]);
  });

  it("exports SVG with the requested options and PNG as a data URL", async () => {
    const { board, calls } = fakeBoard();
    const rpc = new SketchBoardRpc(board, placer, templates);
    await expect(
      rpc.execute("sketch.export_svg", {
        width: 640,
        height: 480,
        padding: 12,
      }),
    ).resolves.toBe("<svg/>");
    expect(calls[0]).toEqual([
      "toSvg",
      [{ width: 640, height: 480, padding: 12 }],
    ]);
    const png = (await rpc.execute("sketch.export_png", {
      pixel_ratio: 1,
    })) as {
      data: string;
    };
    expect(png.data).toBe("data:image/png;base64,iVBORw==");
    expect(calls[1]).toEqual(["toPng", [{ pixelRatio: 1 }]]);
  });

  it("selects then places for ring and fragment templates", async () => {
    const { board, calls } = fakeBoard();
    const rpc = new SketchBoardRpc(board, placer, templates);
    await rpc.execute("sketch.draw_ring", {
      x: 1,
      y: 1,
      size: 5,
      kind: "aliphatic",
    });
    await rpc.execute("sketch.draw_fragment", {
      template_id: "phenyl",
      x: 0,
      y: 0,
      target: 3,
    });
    expect(calls).toEqual([
      ["setRingTemplate", [5, "aliphatic"]],
      ["placeRingAt", [1, 1]],
      ["setFragmentTemplate", ["phenyl"]],
      ["placeFragmentAt", [0, 0, 3]],
    ]);
  });

  it("lists template ids and categories only", async () => {
    const { board } = fakeBoard();
    const rpc = new SketchBoardRpc(board, placer, templates);
    await expect(rpc.execute("sketch.fragment_templates", {})).resolves.toEqual(
      [
        { id: "phenyl", category: "rings" },
        { id: "methyl", category: "groups" },
      ],
    );
  });

  it("returns a frame mapping without coordinates", async () => {
    const { board } = fakeBoard({
      atoms: [
        { element: "C", x: 0, y: 0 },
        { element: "O", x: 1, y: 0 },
      ],
      bonds: [{ i: 0, j: 1, order: 2 }],
    });
    const rpc = new SketchBoardRpc(board, placer, templates);
    await expect(rpc.execute("sketch.to_frame", {})).resolves.toEqual({
      blocks: {
        atoms: { element: ["C", "O"] },
        bonds: { atomi: [0], atomj: [1], bond_type: [2], bond_number: [2] },
      },
    });
  });

  it("answers verbs without a result with null", async () => {
    const { board } = fakeBoard();
    const rpc = new SketchBoardRpc(board, placer, templates);
    await expect(rpc.execute("sketch.clear", {})).resolves.toBeNull();
  });

  it("rejects unknown methods and bad params with JSON-RPC codes", async () => {
    const { board, calls } = fakeBoard();
    const rpc = new SketchBoardRpc(board, placer, templates);
    await expect(rpc.execute("scene.draw_frame", {})).rejects.toMatchObject({
      code: -32601,
    });
    await expect(
      rpc.execute("sketch.draw_atom", { element: "C", x: "1", y: 0 }),
    ).rejects.toBeInstanceOf(SketchRpcError);
    await expect(
      rpc.execute("sketch.draw_bond", { i: 0, j: 1, stereo: "sideways" }),
    ).rejects.toMatchObject({ code: -32602 });
    await expect(
      rpc.execute("sketch.load", { data: { atoms: [] } }),
    ).rejects.toMatchObject({ code: -32602 });
    await expect(
      rpc.execute("sketch.select_atoms", { atom_ids: [0, 1.5] }),
    ).rejects.toMatchObject({ code: -32602 });
    expect(calls).toEqual([]);
  });
});
