import type { Mesh } from "@babylonjs/core";
import { describe, expect, it } from "@rstest/core";
import { ATOM_IMPOSTOR_SPEC } from "../src/artist/material_spec";
import { ImpostorState } from "../src/scene_index";

// ImpostorState's index bookkeeping (getIndex / getIdByIndex / promote /
// renderIndicesForLogicalId) only reads mesh.uniqueId, so a stub mesh works.
// These tests lock the behavior across the identity (no frameInstanceMap) and
// multi-order (frameInstanceMap present) paths — the C7 identity-skip must
// preserve every assertion here.
function makeState(): ImpostorState {
  return new ImpostorState(
    { uniqueId: 7 } as Mesh,
    ATOM_IMPOSTOR_SPEC.bufferDefs,
    64,
  );
}

const NO_BUFFERS = new Map<string, Float32Array>();

describe("ImpostorState index maps", () => {
  describe("identity mapping (no frameInstanceMap)", () => {
    it("getIndex / getIdByIndex are identity over the frame segment", () => {
      const s = makeState();
      s.setFrameData(NO_BUFFERS, 3);
      for (let i = 0; i < 3; i++) {
        expect(s.getIndex(i)).toBe(i);
        expect(s.getIdByIndex(i)).toBe(i);
        expect(s.renderIndicesForLogicalId(i)).toEqual([i]);
      }
    });

    it("append places an edit after the frame segment", () => {
      const s = makeState();
      s.setFrameData(NO_BUFFERS, 3);
      const abs = s.append(100, NO_BUFFERS, 1);
      expect(abs).toBe(3);
      expect(s.getIndex(100)).toBe(3);
      expect(s.getIdByIndex(3)).toBe(100);
      expect(s.renderIndicesForLogicalId(100)).toEqual([3]);
    });

    it("promote moves the frame segment into edit space, preserving ids", () => {
      const s = makeState();
      s.setFrameData(NO_BUFFERS, 3);
      s.promoteFrameSegmentToEdits();
      expect(s.frameOffset).toBe(0);
      // Every former frame id is still resolvable at the same absolute slot.
      for (let i = 0; i < 3; i++) {
        expect(s.getIdByIndex(i)).toBe(i);
        expect(s.getIndex(i)).toBe(i);
      }
    });
  });

  describe("multi-order mapping (frameInstanceMap present)", () => {
    it("tracks all render indices per logical id", () => {
      const s = makeState();
      // 4 render instances, logical ids [0,0,1,1] — two double-bonds.
      s.setFrameData(NO_BUFFERS, 4, new Uint32Array([0, 0, 1, 1]));
      expect(s.getIndex(0)).toBe(0);
      expect(s.getIndex(1)).toBe(2);
      expect(s.renderIndicesForLogicalId(0)).toEqual([0, 1]);
      expect(s.renderIndicesForLogicalId(1)).toEqual([2, 3]);
      // getIdByIndex is identity over the frame segment by design — multi-order
      // logical mapping is carried by the pre-built picking colors, not here.
      expect(s.getIdByIndex(1)).toBe(1);
    });

    it("promote maps every render instance back to its logical id", () => {
      const s = makeState();
      s.setFrameData(NO_BUFFERS, 4, new Uint32Array([0, 0, 1, 1]));
      s.promoteFrameSegmentToEdits();
      expect(s.frameOffset).toBe(0);
      expect(s.getIdByIndex(0)).toBe(0);
      expect(s.getIdByIndex(1)).toBe(0);
      expect(s.getIdByIndex(2)).toBe(1);
      expect(s.getIdByIndex(3)).toBe(1);
    });
  });

  describe("allLogicalIds (select-all universe)", () => {
    it("yields frame ids then edit ids on the identity path", () => {
      const s = makeState();
      s.setFrameData(NO_BUFFERS, 3);
      s.append(100, NO_BUFFERS, 1);
      expect([...s.allLogicalIds()]).toEqual([0, 1, 2, 100]);
    });

    it("yields each multi-order logical id exactly once", () => {
      const s = makeState();
      // 4 render instances but only 2 logical bonds.
      s.setFrameData(NO_BUFFERS, 4, new Uint32Array([0, 0, 1, 1]));
      expect([...s.allLogicalIds()]).toEqual([0, 1]);
    });

    it("is empty for an empty scene", () => {
      const s = makeState();
      s.setFrameData(NO_BUFFERS, 0);
      expect([...s.allLogicalIds()]).toEqual([]);
    });
  });
});
