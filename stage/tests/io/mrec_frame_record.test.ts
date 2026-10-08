/**
 * A `*.mrec` **frame** record must open as the snapshot it carries.
 *
 * A record is a package — `meta` plus any of `frame`, `system`, `trajectory`.
 * molpack writes a packed configuration with `write_frame`, so its records
 * carry `frame` and no `trajectory`, and molrs documents that a store with no
 * `trajectory` section reads as an *empty* `Trajectory` rather than an error.
 * Opening every store as a sequence therefore drew an empty scene and said
 * nothing about why. These pin the door that reads what such a record does
 * carry, and the two answers the ingress branches on.
 */

import { readMrecFrameFiles } from "@molcrafts/molvis-core/molrs";
import { describe, expect, it } from "@rstest/core";
import { mrecStoreGroups } from "../../src/io/mrec_stream";
import { FRAME_RECORD } from "./fixtures/mrec_records";

function storeFiles(
  filter: (key: string) => boolean = () => true,
): Map<string, Uint8Array> {
  return new Map(
    Object.entries(FRAME_RECORD)
      .filter(([key]) => filter(key))
      .map(([key, base64]) => [
        key,
        Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)),
      ]),
  );
}

describe("mrec frame records", () => {
  it("reads the snapshot a sequence reader finds nothing in", () => {
    const frame = readMrecFrameFiles(storeFiles());
    expect(frame).toBeDefined();
    expect(frame?.get("atoms").nRows).toBe(3);
    expect(frame?.box).toBeDefined();
    frame?.free();
  });

  it("is undefined for a record that carries no frame section", () => {
    // The same record with its `frame/` group removed: still a readable
    // record, just not one holding a snapshot. The ingress uses this answer
    // to tell "wrong shape" from "unreadable".
    const withoutFrame = storeFiles((key) => !key.startsWith("frame/"));
    expect(readMrecFrameFiles(withoutFrame)).toBeUndefined();
  });
});

describe("mrec store groups", () => {
  it("reads the record's shape from the keys, before anything is parsed", () => {
    // Free, and it has to be: the alternative is opening the sequence, which
    // hands the store's buffers to the worker in a transfer list and detaches
    // them — so a snapshot read attempted afterwards finds nothing left.
    // That detachment is the bug this pins:
    //   "Cannot perform Construct on a detached or out-of-bounds ArrayBuffer"
    expect(mrecStoreGroups({ kind: "files", files: storeFiles() })).toEqual(
      new Set(["meta", "frame"]),
    );
  });

  it("sees both sections when a record carries both", () => {
    // The shape a run produces: the topology written once as `frame`, the
    // coordinates every step as `trajectory`. The ingress must open both and
    // let composition put them together, not pick one. (Verified against a
    // real spliced record: sections {meta, frame, trajectory}, 3 atoms in the
    // frame, 3 steps in the sequence.)
    const files = new Map<string, Uint8Array>([
      ["zarr.json", new Uint8Array()],
      ["meta/zarr.json", new Uint8Array()],
      ["frame/atoms/x/zarr.json", new Uint8Array()],
      ["trajectory/atoms/x/c/0", new Uint8Array()],
    ]);
    expect(mrecStoreGroups({ kind: "files", files })).toEqual(
      new Set(["meta", "frame", "trajectory"]),
    );
  });

  it("is empty for a packed store, whose keys live inside the archive", () => {
    expect(
      mrecStoreGroups({ kind: "zip", blob: new Blob([new Uint8Array()]) }),
    ).toEqual(new Set());
  });

  it("a detached store still reports its groups", () => {
    // The keys survive what the buffers do not, which is the whole point of
    // deciding the shape from them.
    const files = storeFiles();
    const groups = mrecStoreGroups({ kind: "files", files });
    for (const bytes of files.values()) {
      structuredClone(bytes.buffer, { transfer: [bytes.buffer] });
    }
    expect(mrecStoreGroups({ kind: "files", files })).toEqual(groups);
  });
});
