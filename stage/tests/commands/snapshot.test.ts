import { describe, expect, it } from "@rstest/core";
import { resolveSnapshotOptions } from "../../src/commands/snapshot";

describe("resolveSnapshotOptions", () => {
  it("defaults to the canvas as shown", () => {
    expect(resolveSnapshotOptions({})).toEqual({
      scale: 1,
      transparent: false,
      axes: true,
      cropMargin: null,
    });
  });

  it("makes a cropped capture transparent", () => {
    expect(resolveSnapshotOptions({ axes: false, cropMargin: 4 })).toEqual({
      scale: 1,
      transparent: true,
      axes: false,
      cropMargin: 4,
    });
  });

  it("refuses what cannot be captured", () => {
    expect(() => resolveSnapshotOptions({ scale: 2 })).toThrow(/axes/);
    expect(() => resolveSnapshotOptions({ transparent: true })).toThrow(/axes/);
    expect(() =>
      resolveSnapshotOptions({
        axes: false,
        cropMargin: 4,
        transparent: false,
      }),
    ).toThrow(/transparent/);
    expect(() => resolveSnapshotOptions({ scale: 0, axes: false })).toThrow();
    expect(() =>
      resolveSnapshotOptions({ axes: false, cropMargin: -1 }),
    ).toThrow();
    expect(() => resolveSnapshotOptions({ axes: "no" })).toThrow();
  });
});
