import * as assert from "assert";
import {
  getDisplayName,
  isZarrUriPath,
} from "../../../src/extension/loading/pathUtils";

suite("pathUtils", () => {
  test("getDisplayName returns basename", () => {
    const uri = { fsPath: "/tmp/a/b/frame.xyz" } as never;
    assert.strictEqual(getDisplayName(uri), "frame.xyz");
  });

  test("isZarrUriPath matches directory zarr path", () => {
    const uri = { path: "/tmp/data/root.zarr" } as never;
    assert.strictEqual(isZarrUriPath(uri, 2), true);
  });

  test("isZarrUriPath rejects files and non-zarr directories", () => {
    const fileUri = { path: "/tmp/data/root.zarr" } as never;
    const dirUri = { path: "/tmp/data/root.xyz" } as never;

    assert.strictEqual(isZarrUriPath(fileUri, 1), false);
    assert.strictEqual(isZarrUriPath(dirUri, 2), false);
  });
});
