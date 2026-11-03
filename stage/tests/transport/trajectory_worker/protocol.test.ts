import { describe, expect, it } from "@rstest/core";
import {
  type FrameMessage,
  frameMessageTransferList,
  isMrecSourceHandle,
  type MrecSourceHandle,
  mrecSourceTransferList,
} from "../../../src/transport/trajectory_worker/protocol";

describe("mrec source handles", () => {
  it("isMrecSourceHandle recognises the three store shapes only", () => {
    expect(isMrecSourceHandle({ kind: "mrec-files", files: new Map() })).toBe(
      true,
    );
    expect(
      isMrecSourceHandle({ kind: "mrec-file-tree", files: new Map() }),
    ).toBe(true);
    expect(
      isMrecSourceHandle({ kind: "mrec-zip", bytes: new ArrayBuffer(1) }),
    ).toBe(true);
    expect(isMrecSourceHandle({ kind: "blob", totalBytes: 1 })).toBe(false);
    expect(isMrecSourceHandle({ kind: "opfs", filename: "x" })).toBe(false);
  });

  it("mrecSourceTransferList moves buffers and clones File handles", () => {
    const a = new ArrayBuffer(2);
    const b = new ArrayBuffer(3);
    const files: MrecSourceHandle = {
      kind: "mrec-files",
      files: new Map([
        ["a", a],
        ["b", b],
      ]),
    };
    expect(mrecSourceTransferList(files)).toEqual([a, b]);
    const zip: MrecSourceHandle = { kind: "mrec-zip", bytes: a };
    expect(mrecSourceTransferList(zip)).toEqual([a]);
    const tree: MrecSourceHandle = {
      kind: "mrec-file-tree",
      files: new Map([["a", new File([], "a")]]),
    };
    expect(mrecSourceTransferList(tree)).toEqual([]);
  });
});

describe("frameMessageTransferList", () => {
  it("includes a block shape buffer alongside the columns", () => {
    const shape = new Uint32Array([2, 2, 2]);
    const data = new Float64Array(8);
    const msg: FrameMessage = {
      kind: "frame",
      frameId: 0,
      blocks: [
        {
          name: "grid",
          columns: [{ name: "rho", dtype: "f64", data }],
          shape,
        },
      ],
      box: null,
      sectionUpdates: { grid: 0 },
    };
    const transfer = frameMessageTransferList(msg);
    expect(transfer).toContain(data.buffer);
    expect(transfer).toContain(shape.buffer);
    expect(transfer).toHaveLength(2);
  });
});
