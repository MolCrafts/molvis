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
 * The molrec reader uses one typed constructor: `new MrecReader(source)`
 * accepts files, packed bytes, or a synchronous `MrecStorageHost`. A record's
 * snapshot is `new MrecFile(source).frame()`.
 *
 * ## Meshes (`readStl`)
 *
 * {@link readStlMesh} is the whole story for surface geometry: it reads, copies
 * the arrays out, and frees the wasm `TriMesh` before returning. No mesh handle
 * ever leaves this module, so the handle-tracking rule
 * (`.claude/notes/molrs-handles.md`) has nothing to track for one.
 */

import { readStl } from "@molcrafts/molrs";

/** Compatibility spelling for the upstream store-host contract. */
export type { MrecStorageHost as MrecStoreHost } from "@molcrafts/molrs";
export * from "@molcrafts/molrs";

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
  const mesh = readStl(bytes);
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
