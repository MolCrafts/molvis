/**
 * Sole monorepo import face for `@molcrafts/molrs`.
 *
 * sketch / stage / page must import Frame/Block/Conformer from
 * `@molcrafts/molvis-core/molrs` (or the core barrel), never from
 * `@molcrafts/molrs` directly — so the app bundler keeps a single WASM instance.
 *
 * Marked side-effectful in package.json so WASM init is preserved. Pure data
 * lives in `./elements` and does not import this module.
 *
 * ## mrec (`MrecReader`)
 *
 * The molrec Zarr-v3 reader is re-exported as-is. Its three doors, in
 * increasing laziness: `new MrecReader(files)` (whole store copied into
 * wasm), `MrecReader.fromZip(bytes)` (packed `*.mrec.zip`, stored
 * entries), and `MrecReader.fromStorage(host)` — a synchronous
 * {@link MrecStoreHost} that serves keys on demand so only the chunks a frame
 * touches ever cross into wasm. `fromStorage` is typed `any` by wasm-bindgen;
 * {@link openMrecStore} is the typed door every package should use.
 *
 * ## Meshes (`readStlBytes`)
 *
 * {@link readStlMesh} is the whole story for surface geometry: it reads, copies
 * the arrays out, and frees the wasm `TriMesh` before returning. No mesh handle
 * ever leaves this module, so the handle-tracking rule
 * (`.claude/notes/molrs-handles.md`) has nothing to track for one.
 *
 * ## Stored frames
 *
 * molrs 0.17 writes one function per format. {@link readEncodedFrame} and
 * {@link writeEncodedFrame} are the molvis doors for a stored format tag
 * (`msgpack`, `json`, `dcd`) — project files and the RPC seam keep that tag.
 */

import {
  type Frame,
  MrecReader,
  readDcdBytes,
  readJsonFrameStr,
  readMrecFrameBytes,
  readMrecFrameFiles,
  readMsgpackFrameBytes,
  readStlBytes,
  writeDcdBytes,
  writeJsonFrameStr,
  writeMsgpackFrameBytes,
} from "@molcrafts/molrs";

export * from "@molcrafts/molrs";

/**
 * Synchronous key/value host an mrec `MrecReader` reads a store
 * through (`MrecReader.fromStorage`).
 *
 * Keys are store-relative POSIX paths without a leading slash
 * (`trajectory/step/zarr.json`). Every method is **synchronous** — the reader
 * calls back into JS from inside a wasm frame decode — so a host either owns
 * the bytes (in-memory map) or runs where synchronous file reads exist (a
 * worker with `FileReaderSync`). Every array is sharded with the shard index
 * at the start of the file; the reader asks for byte ranges, never whole
 * shards, whenever {@link MrecStoreHost.getRange} is present.
 */
export interface MrecStoreHost {
  /** The whole value of `key`, or `null` when absent. */
  get(key: string): Uint8Array | null;
  /**
   * Bytes `[offset, offset + length)` of `key`; `length === -1` means "to the
   * end". Optional but strongly preferred: without it the reader falls back
   * to {@link MrecStoreHost.get} and slices, which reads whole shards.
   */
  getRange?(key: string, offset: number, length: number): Uint8Array | null;
  /** Byte length of `key`, or `null` when absent. */
  size(key: string): number | null;
  /**
   * Every key under `prefix` (`""` for all), as full store-relative keys.
   * Prefixes end with `/` (`trajectory/atoms/`) or are empty.
   */
  list(prefix: string): string[];
}

/**
 * Open an mrec store served on demand by `host` — the typed face of
 * `MrecReader.fromStorage`. Index-only: no frame is decoded here.
 */
export function openMrecStore(host: MrecStoreHost): MrecReader {
  return MrecReader.fromStorage(host);
}

/**
 * A triangle surface, copied out of wasm.
 *
 * Geometry, not render buffers: vertices are shared and faces index into them,
 * exactly as the mesh is stored. Expanding to one vertex per corner is the
 * renderer's business (`stage/src/io/stl.ts`), not this seam's.
 */
export interface TriangleMeshData {
  /** Vertex coordinates, three per vertex. */
  vertices: Float32Array;
  /** Corner indices into {@link TriangleMeshData.vertices}, three per face. */
  faces: Uint32Array;
  /** One unit normal per face, three components each. */
  faceNormals: Float32Array;
  /** Whether the surface is closed — every directed edge has one opposite. */
  watertight: boolean;
}

/**
 * Read an STL — ASCII or binary, told apart by length in molrs — into plain
 * typed arrays.
 *
 * The wasm `TriMesh` never leaves this function: its arrays are copied out and it
 * is freed before returning, so a mesh costs one decode and no live handle.
 * That is affordable precisely because it happens once per file, unlike a
 * computed surface, which is re-derived every pipeline pass and stays in JS.
 *
 * Throws the molrs message when the bytes are not an STL. A file with no
 * facets is not an error here: it comes back with zero faces, and the caller
 * decides what that means.
 */
export function readStlMesh(bytes: Uint8Array): TriangleMeshData {
  const mesh = readStlBytes(bytes);
  try {
    return {
      vertices: mesh.vertices(),
      faces: mesh.faces(),
      faceNormals: mesh.faceNormals(),
      watertight: mesh.isWatertight(),
    };
  } finally {
    mesh.free();
  }
}

/**
 * The record's `frame` section, or `undefined` when it carries none.
 *
 * A `*.mrec` record is a package, not a single object: `meta` plus any of a
 * snapshot (`frame`), a topology (`system`), a frame sequence (`trajectory`),
 * and they coexist — a run commonly writes the topology once as `frame` and
 * the coordinates every step as `trajectory`. `MrecReader` answers about
 * the sequence and nothing else; this reads **only** the `frame` section, so
 * asking for the topology never costs a decode of the run.
 *
 * The returned `Frame` is a live molrs handle and belongs to the caller, the
 * same as any reader-produced frame.
 */
export function readMrecFrameRecord(
  files: Map<string, Uint8Array>,
): Frame | undefined {
  return readMrecFrameFiles(files as Map<unknown, unknown>) ?? undefined;
}

/** {@link readMrecFrameRecord} for a packed `*.mrec.zip`. */
export function readMrecFrameRecordFromZip(
  bytes: Uint8Array,
): Frame | undefined {
  return readMrecFrameBytes(bytes) ?? undefined;
}

/**
 * Decode a frame molvis stored under a format tag.
 *
 * `msgpack` and `dcd` are byte doors. `json` is molrs's text frame, so the
 * bytes are decoded as UTF-8 first.
 */
export function readEncodedFrame(data: Uint8Array, format: string): Frame {
  switch (format) {
    case "msgpack":
      return readMsgpackFrameBytes(data);
    case "json":
      return readJsonFrameStr(new TextDecoder().decode(data));
    case "dcd":
      return readDcdBytes(data);
    default:
      throw new Error(
        `molrs 0.17 has no stored-frame reader for "${format}" (msgpack, json, dcd)`,
      );
  }
}

/**
 * Encode a frame for a stored format tag. `json` comes back as UTF-8 bytes
 * of `writeJsonFrameStr`.
 */
export function writeEncodedFrame(frame: Frame, format: string): Uint8Array {
  switch (format) {
    case "msgpack":
      return writeMsgpackFrameBytes(frame);
    case "json":
      return new TextEncoder().encode(writeJsonFrameStr(frame));
    case "dcd":
      return writeDcdBytes(frame);
    default:
      throw new Error(
        `molrs 0.17 has no stored-frame writer for "${format}" (msgpack, json, dcd)`,
      );
  }
}
