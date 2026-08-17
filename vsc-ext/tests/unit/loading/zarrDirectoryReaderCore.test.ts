import * as assert from "assert";
import {
  FILE_TYPE_DIRECTORY,
  FILE_TYPE_FILE,
  readZarrDirectoryWithFs,
} from "../../../src/extension/loading/zarrDirectoryReaderCore";

interface MockUri {
  path: string;
}

suite("zarrDirectoryReaderCore", () => {
  test("reads nested tree and returns base64 map with relative keys", async () => {
    const fs = {
      readDirectory: async (uri: MockUri): Promise<Array<[string, number]>> => {
        if (uri.path.endsWith("/root.zarr")) {
          return [
            ["group", FILE_TYPE_DIRECTORY],
            [".zgroup", FILE_TYPE_FILE],
          ];
        }
        if (uri.path.endsWith("/root.zarr/group")) {
          return [
            ["array", FILE_TYPE_DIRECTORY],
            [".zattrs", FILE_TYPE_FILE],
          ];
        }
        if (uri.path.endsWith("/root.zarr/group/array")) {
          return [
            ["0.0", FILE_TYPE_FILE],
            ["0.1", FILE_TYPE_FILE],
          ];
        }
        return [];
      },
      readFile: async (uri: MockUri): Promise<Uint8Array> => {
        const name = uri.path.split("/").pop() || "unknown";
        return Buffer.from(`content of ${name}`);
      },
    };

    const uriHelpers = {
      joinPath: (base: MockUri, ...pathSegments: string[]): MockUri => ({
        path: `${base.path}/${pathSegments.join("/")}`,
      }),
    };

    const uri = { path: "/tmp/root.zarr" };
    const files = await readZarrDirectoryWithFs(uri, fs, uriHelpers);

    assert.deepStrictEqual(Object.keys(files).sort(), [
      ".zgroup",
      "group/.zattrs",
      "group/array/0.0",
      "group/array/0.1",
    ]);

    for (const key of Object.keys(files)) {
      assert.ok(!key.startsWith("/"), `Unexpected absolute key: ${key}`);
    }

    assert.strictEqual(
      files["group/array/0.0"],
      Buffer.from("content of 0.0").toString("base64"),
    );
  });
});
