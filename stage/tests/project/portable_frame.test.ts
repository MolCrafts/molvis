import { toDomainUint } from "@molcrafts/molvis-core";
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
  atoms.set("element", ["O", "H", "H"]);
  atoms.set("x", new Float64Array([0, 0.96, -0.24]));
  atoms.set("y", new Float64Array([0, 0, 0.93]));
  atoms.set("z", new Float64Array([0, 0, 0]));
  frame.set("atoms", atoms);
  const bonds = new Block();
  bonds.set("atomi", toDomainUint([0, 0]));
  bonds.set("atomj", toDomainUint([1, 2]));
  bonds.set("bond_type", toDomainUint([1, 1]));
  bonds.set("bond_number", toDomainUint([1, 1]));
  frame.set("bonds", bonds);
  return frame;
}

describe("portable frames for project files", () => {
  it("round-trips element and bond topology as molrs Frame bytes", () => {
    const src = waterFrame();
    const portable = frameToPortable(src);
    expect(portable.format).toBe("msgpack");
    expect(portable.base64.length).toBeGreaterThan(0);
    const dst = portableToFrame(portable, "test");
    const els = dst.get("atoms")?.copy("element");
    expect([...(els as string[])]).toEqual(["O", "H", "H"]);
    const types = dst.get("bonds")?.view("bond_type");
    expect(types && Array.from(types, Number)).toEqual([1, 1]);
    src.free();
    dst.free();
  });

  it("names the context when the bytes are not a Frame", () => {
    expect(() =>
      portableToFrame({ format: "msgpack", base64: btoa("nope") }, "ctx"),
    ).toThrow(/ctx/);
  });
});

describe("isMolvisProject", () => {
  it("accepts a project document", () => {
    expect(
      isMolvisProject({
        format: MOLVIS_PROJECT_FORMAT,
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
              typeName: "MemoryDataSource",
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
    expect(
      isMolvisProject({
        format: "molvis.project/v1",
        pipeline: [],
      }),
    ).toBe(false);
    expect(isMolvisProject({ format: "nope" })).toBe(false);
  });
});
