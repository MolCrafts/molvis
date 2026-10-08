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
 */

import { MrecReader, readStlBytes } from "@molcrafts/molrs";

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
