import { describe, expect, it } from "@rstest/core";
import "../setup_wasm";
import { Block, Frame } from "@molcrafts/molvis-core/molrs";
import { isMolvisProject, MOLVIS_PROJECT_FORMAT } from "../../src/project";
import {
  frameToPortable,
  portableToFrame,
} from "../../src/project/portable_frame";

function waterFrame(): Frame {
  const frame = new Frame();
  const atoms = new Block();
  atoms.setColStr("element", ["O", "H", "H"]);
  atoms.setColF("x", new Float64Array([0, 0.96, -0.24]));
  atoms.setColF("y", new Float64Array([0, 0, 0.93]));
  atoms.setColF("z", new Float64Array([0, 0, 0]));
  frame.insertBlock("atoms", atoms);
  const bonds = new Block();
  bonds.setColU32("atomi", new Uint32Array([0, 0]));
  bonds.setColU32("atomj", new Uint32Array([1, 2]));
  bonds.setColU32("bond_type", new Uint32Array([1, 1]));
  bonds.setColU32("bond_number", new Uint32Array([1, 1]));
  frame.insertBlock("bonds", bonds);
  return frame;
}

describe("portable frame wire for project files", () => {
  it("round-trips element and bond topology", () => {
    const src = waterFrame();
    const portable = frameToPortable(src);
    expect(portable.buffers.length).toBeGreaterThan(0);
    const dst = portableToFrame(portable, "test");
    const els = dst.getBlock("atoms")?.copyColStr("element");
    expect(els).toEqual(["O", "H", "H"]);
    const types = dst.getBlock("bonds")?.viewColU32("bond_type");
    expect(types && Array.from(types)).toEqual([1, 1]);
    src.free();
    dst.free();
  });
});

describe("isMolvisProject", () => {
  it("accepts v1 documents", () => {
    expect(
      isMolvisProject({
        format: MOLVIS_PROJECT_FORMAT,
        version: 1,
        createdAt: new Date().toISOString(),
        view: {
          camera: {
            alpha: 0,
            beta: 0,
            radius: 10,
            target: [0, 0, 0],
            position: [0, 0, 10],
            up: [0, 1, 0],
          },
          representation: { name: "ball-and-stick" },
          showBox: true,
        },
        pipeline: [
          {
            id: "ds0",
            type: "DataSource",
            enabled: true,
            selection_scope_id: null,
            source_owner_id: null,
            dataSource: {
              kind: "memory",
              filename: "Scene",
              sourceType: "backend",
              contributedBlocks: [],
              frames: [],
            },
          },
        ],
      }),
    ).toBe(true);
  });

  it("rejects garbage", () => {
    expect(isMolvisProject(null)).toBe(false);
    expect(isMolvisProject({ format: "nope" })).toBe(false);
  });
});
