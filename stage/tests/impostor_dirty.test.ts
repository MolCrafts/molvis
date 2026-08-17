import type { Mesh } from "@babylonjs/core";
import { describe, expect, it } from "@rstest/core";
import { ImpostorState } from "../src/scene_index";

// The dirty-tracking API does not touch the mesh, so a bare stub suffices.
function makeState(): ImpostorState {
  return new ImpostorState({} as Mesh, [
    { name: "matrix", stride: 16 },
    { name: "instanceData", stride: 4 },
    { name: "instanceColor", stride: 4 },
    { name: "instancePickingColor", stride: 4 },
  ]);
}

describe("ImpostorState dirty tracking", () => {
  it("starts clean", () => {
    const s = makeState();
    expect(s.needsUpload).toBe(false);
  });

  it("markDirty flags only the named buffers (partial upload)", () => {
    const s = makeState();
    s.markDirty("matrix", "instanceData");
    expect(s.needsUpload).toBe(true);
    expect(s.isAllDirty).toBe(false);
    expect(s.isBufferDirty("matrix")).toBe(true);
    expect(s.isBufferDirty("instanceData")).toBe(true);
    // Unchanged buffers must NOT be re-uploaded — this is the optimization.
    expect(s.isBufferDirty("instanceColor")).toBe(false);
    expect(s.isBufferDirty("instancePickingColor")).toBe(false);
  });

  it("markAllDirty flags every buffer", () => {
    const s = makeState();
    s.markAllDirty();
    expect(s.isAllDirty).toBe(true);
    expect(s.isBufferDirty("instanceColor")).toBe(true);
    expect(s.isBufferDirty("instancePickingColor")).toBe(true);
  });

  it("a pending full upload wins over a partial mark", () => {
    const s = makeState();
    s.markAllDirty();
    s.markDirty("matrix");
    expect(s.isAllDirty).toBe(true);
    expect(s.isBufferDirty("instanceColor")).toBe(true);
  });

  it("markUploaded clears all dirty state", () => {
    const s = makeState();
    s.markAllDirty();
    s.markDirty("matrix");
    s.markUploaded();
    expect(s.needsUpload).toBe(false);
    expect(s.isAllDirty).toBe(false);
    expect(s.isBufferDirty("matrix")).toBe(false);
  });
});
