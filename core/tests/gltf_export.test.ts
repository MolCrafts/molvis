import { NullEngine } from "@babylonjs/core";
import { Block, Frame } from "@molcrafts/molrs";
import { describe, expect, it } from "@rstest/core";
import "./setup_wasm";
import { exportFrameToGLB } from "../src/export/gltf";

/** A minimal C–O frame with one bond. */
function makeFrame(): Frame {
  const frame = new Frame();
  const atoms = new Block();
  atoms.setColF("x", new Float64Array([0, 1.2]));
  atoms.setColF("y", new Float64Array([0, 0]));
  atoms.setColF("z", new Float64Array([0, 0]));
  atoms.setColStr("element", ["C", "O"]);
  frame.insertBlock("atoms", atoms);
  const bonds = new Block();
  bonds.setColU32("atomi", new Uint32Array([0]));
  bonds.setColU32("atomj", new Uint32Array([1]));
  frame.insertBlock("bonds", bonds);
  return frame;
}

describe("exportFrameToGLB", () => {
  it("serializes a frame to a valid, matte, per-element binary glTF", async () => {
    const engine = new NullEngine();
    try {
      const bytes = await exportFrameToGLB(makeFrame(), engine);
      const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

      // GLB container: magic "glTF", version 2, self-consistent length.
      expect(dv.getUint32(0, true)).toBe(0x46546c67);
      expect(dv.getUint32(4, true)).toBe(2);
      expect(dv.getUint32(8, true)).toBe(bytes.byteLength);

      // JSON chunk (after the 12-byte header + 8-byte chunk header).
      const jsonLen = dv.getUint32(12, true);
      const json = JSON.parse(
        new TextDecoder().decode(bytes.subarray(20, 20 + jsonLen)),
      );

      // C and O give two colour groups → two matte, opaque materials.
      expect(json.materials).toHaveLength(2);
      for (const m of json.materials) {
        expect(m.pbrMetallicRoughness.metallicFactor).toBe(0);
        expect(m.pbrMetallicRoughness.roughnessFactor).toBeGreaterThan(0.5);
      }
      expect(json.meshes).toHaveLength(2);
    } finally {
      engine.dispose();
    }
  });

  it("throws when the frame has no atoms", async () => {
    const engine = new NullEngine();
    try {
      await expect(exportFrameToGLB(new Frame(), engine)).rejects.toThrow(
        /no atoms/,
      );
    } finally {
      engine.dispose();
    }
  });
});
