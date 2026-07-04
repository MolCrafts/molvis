import { Frame } from "@molcrafts/molrs";
import type { MolvisApp as Molvis } from "../app";
import { applyAutoAttach } from "../pipeline/auto_attach";
import {
  type BondColumnMapping,
  BondColumnRemapModifier,
  bondsIntegerColumns,
  bondsNeedColumnMapping,
} from "../pipeline/bond_column_remap";
import {
  DataSourceModifier,
  FileDataSource,
  MemoryDataSource,
} from "../pipeline/data_source_modifier";
import { DrawBondModifier } from "../pipeline/draw_bond";
import { type AsyncFrameProvider, Trajectory } from "../system/trajectory";
import {
  type IndexProgressCallback,
  spawnTrajectoryWorker,
  type TrajectoryRuntime,
} from "../transport/trajectory_worker";
import { fingerprintFile } from "./cache";
import {
  canStream,
  type FileFormat,
  loadBinaryTrajectory,
  loadTextTrajectory,
} from "./reader";
import { BlobRangeSource } from "./sources";
import { loadZarrFiles } from "./zarr";

export {
  canStream,
  describeFormat,
  FILE_FORMAT_REGISTRY,
  type FileFormat,
  type FileFormatDescriptor,
  type FormatPayload,
  getAllAcceptExtensions,
  inferFormatFromFilename,
  isBinaryFormat,
  isStreamingOnly,
  loadBinaryTrajectory,
  loadTextTrajectory,
  readFrames,
  type StreamingCapability,
} from "./reader";
export { BlobRangeSource, type TrajectorySource } from "./sources";
export {
  defaultExtensionForFormat,
  type ExportFormat,
  type ExportPayload,
  exportFrame,
  isWritableFormat,
  mimeForFormat,
  type WriteFrameOptions,
  writableFormats,
  writeFrame,
  writeLAMMPSData,
  writePDBFrame,
  writeXYZFrame,
} from "./writer";
export { loadZarrFiles, type ZarrLoadResult } from "./zarr";

/**
 * Payload shape accepted by {@link loadFileContent}.
 *
 * - `string` — a text-format file body (PDB/XYZ/LAMMPS/SDF/…). The
 *   resolved descriptor must declare `payload: "text"`.
 * - `Uint8Array` — raw bytes for a binary-format file (e.g. DCD). The
 *   resolved descriptor must declare `payload: "binary"`. No format
 *   currently declares this; the dispatch branch is wired so that
 *   future binary readers slot in without changing call-site code.
 * - `Record<string, string>` — a zarr directory serialized as
 *   `filePath → base64` pairs.
 *
 * The discriminator at runtime is structural: `typeof === "string"`
 * for text, `instanceof Uint8Array` for binary, otherwise zarr.
 */
export type FileContent = string | Uint8Array | Record<string, string>;

/**
 * How a file ingress combines with the existing system:
 * - `"replace"` — clear the pipeline's data source and install this
 *   file as the new primary trajectory. Default; preserves the
 *   pre-multi-DS UX where opening a file resets the scene.
 * - `"append"` — add this file as an additional DataSourceModifier
 *   alongside any existing ones, applying the multi-data-source spec's
 *   load decision tree (single-frame → broadcast `MemoryDataSource`,
 *   N-frame → index-aligned `FileDataSource`, mismatched N →
 *   throw). Used by drag-drop on a non-empty system and the explicit
 *   "Add Data Source" UI button (phase 3 of the spec).
 * - `"auto"` — drag-drop default. Behaves like `"replace"`, except when
 *   the current scene is a single static structure that carries topology
 *   (a one-frame source with a non-empty `bonds` block) and the dropped
 *   file is a multi-frame trajectory: then the trajectory becomes the
 *   primary timeline (positions + box) and the existing topology is
 *   re-housed as a broadcast overlay so every frame inherits its bonds —
 *   "open a `.data`, drop a `.lammpstrj`, play the trajectory with its
 *   bonds intact". See {@link mergeTrajectoryOntoTopology}.
 *
 * The topology-preserving merge also fires under `"append"` for the same
 * static-topology-then-trajectory shape, replacing what used to be a
 * frame-count-mismatch throw.
 */
export type LoadMode = "replace" | "append" | "auto";

/**
 * Re-export so consumers driving the column-mapping dialog can build
 * `BondColumnMapping` values without reaching into the `pipeline/`
 * submodule. Same shape as `pipeline/bond_column_remap` exports.
 */
export type { BondColumnMapping } from "../pipeline/bond_column_remap";

/**
 * Outcome of a column-mapping prompt for a `bonds`-only file whose
 * columns don't match molvis's canonical `atomi`/`atomj` schema. The
 * dialog returns `null` when the user cancels — that aborts the load.
 */
export type BondMappingDecision = BondColumnMapping | null;

/**
 * Async callback the load flow invokes when a parsed frame contains a
 * `bonds` block lacking `atomi`/`atomj` columns. The host (page UI,
 * VSCode extension, ...) shows a modal listing the candidate integer
 * columns and resolves with the user's choice — or `null` to cancel
 * the whole load.
 *
 * Mirrors the `pickFormat` plumbing pattern: a small async hook that
 * the core ingress calls without knowing anything about the host UI.
 */
export type PickBondMapping = (
  filename: string,
  candidates: string[],
) => Promise<BondMappingDecision>;

/**
 * Apply the multi-DS load decision tree against an already-built
 * {@link Trajectory}, construct the right kind of
 * {@link DataSourceModifier}, and append it via
 * {@link Molvis.addDataSource}. Throws on frame-count or block-type
 * mismatch with concrete numbers; the caller is expected to surface
 * the error to the user (e.g. via a status-message event).
 *
 * Does NOT dispose `trajectory` on its own. On error path, ownership
 * stays with the caller so they decide whether to retry / free.
 */
async function appendTrajectoryAsDataSource(
  app: Molvis,
  trajectory: Trajectory,
  meta: {
    filename: string;
    sourceType: DataSourceModifier["sourceType"];
  },
  pickBondMapping?: PickBondMapping,
): Promise<void> {
  const N_file = trajectory.length;
  const existingTraj = app.modifierPipeline
    .getModifiers()
    .find((m): m is FileDataSource => m instanceof FileDataSource);

  const probeFrame = await trajectory.frame(0);

  // Block-type consistency: if both the existing system and the new file
  // contribute an `atoms` block, their atom counts must match — bonds /
  // selections downstream key off atom indices, and a silent atom-count
  // change would dangle them.
  const currentAtoms = app.system.frame?.getBlock("atoms");
  const currentAtomCount = currentAtoms?.nrows() ?? 0;
  if (currentAtomCount > 0) {
    const probeAtoms = probeFrame.getBlock("atoms");
    if (probeAtoms !== undefined && probeAtoms.nrows() !== currentAtomCount) {
      throw new Error(
        `Cannot append "${meta.filename}": file has ${probeAtoms.nrows()} atom(s); existing system has ${currentAtomCount}. Multi-source loads must agree on atom count when both files contribute an atoms block.`,
      );
    }
  }

  // OVITO-style column mapping. If the bonds block exists but lacks the
  // canonical `atomi`/`atomj` columns, prompt the host for a mapping;
  // a `null` reply aborts the whole append. Performed before constructing
  // the DS so a user-cancel doesn't leave a half-attached DS in the pipe.
  const mapping = await maybePromptBondMapping(
    probeFrame,
    meta.filename,
    pickBondMapping,
  );

  let ds: DataSourceModifier;
  if (N_file === 1) {
    // Single-frame file → MemoryDataSource. Broadcasts across whatever
    // trajectory length the pipeline already has (or stays at 1 if
    // there's no trajectory yet). `contributedBlocks` defaults to empty
    // → the synthesis head propagates every block the frame actually has.
    ds = new MemoryDataSource(probeFrame, meta);
  } else if (existingTraj === undefined || existingTraj.frameCount === N_file) {
    // Multi-frame file: either becomes the primary trajectory (no
    // existing one) or stacks onto an existing trajectory of equal
    // length. Frame-count mismatches are caught here OR in
    // addDataSource — both produce the same error class.
    ds = new FileDataSource(trajectory, meta);
  } else {
    throw new Error(
      `Cannot append "${meta.filename}": file has ${N_file} frame(s); existing trajectory has ${existingTraj.frameCount}. File must be single-frame (topology) or match existing frame count.`,
    );
  }

  await app.addDataSource(ds);

  if (mapping !== null) {
    attachBondMappingChildren(app, ds, mapping);
    // The remap + DrawBond modifiers were appended after addDataSource's
    // built-in applyPipeline ran, so re-run once more so they take
    // effect on the same load tick.
    await app.applyPipeline({ fullRebuild: true });
  }
}

/**
 * Probe `frame` for an unmapped bonds block and, if found, ask the
 * host (via `pickBondMapping`) how to map its columns onto the
 * canonical `atomi`/`atomj` schema.
 *
 * Returns:
 * - `null` — no prompt needed (no bonds block, already canonical, or
 *   not enough integer columns to map). Caller proceeds without remap.
 * - {@link BondColumnMapping} — user-confirmed mapping. Caller attaches
 *   a {@link BondColumnRemapModifier} downstream of the DS.
 *
 * Throws a `BondMappingCancelledError` when the host returns `null` —
 * the caller catches it and aborts the load with a "cancelled" status.
 */
async function maybePromptBondMapping(
  frame: Frame,
  filename: string,
  pickBondMapping: PickBondMapping | undefined,
): Promise<BondColumnMapping | null> {
  if (!bondsNeedColumnMapping(frame)) return null;
  const candidates = bondsIntegerColumns(frame);
  if (candidates.length < 2) return null;
  if (!pickBondMapping) return null;
  const decision = await pickBondMapping(filename, candidates);
  if (decision === null) {
    throw new BondMappingCancelledError(filename);
  }
  return decision;
}

/** Thrown by the load flow when the user cancels the bond column
 *  mapping dialog. The outer `loadFileSmart` catch surfaces this as a
 *  cancellation, not an error. */
export class BondMappingCancelledError extends Error {
  constructor(filename: string) {
    super(`Bond column mapping cancelled for ${filename}`);
    this.name = "BondMappingCancelledError";
  }
}

/**
 * Attach a `BondColumnRemapModifier` (rewrites the bonds block
 * columns) and a `DrawBondModifier` (renders bonds) under `ds`. Both
 * land at the end of the pipeline array, so phase B runs them after
 * any pre-existing modifiers — DrawBond sees the post-remap columns.
 */
function attachBondMappingChildren(
  app: Molvis,
  ds: DataSourceModifier,
  mapping: BondColumnMapping,
): void {
  const remap = new BondColumnRemapModifier("bond-column-remap", mapping);
  app.modifierPipeline.addModifier(remap);
  app.modifierPipeline.setParent(remap.id, ds.id);

  const drawBond = new DrawBondModifier();
  app.modifierPipeline.addModifier(drawBond);
  app.modifierPipeline.setParent(drawBond.id, ds.id);
}

// Tracks per-app cleanup for the active lazy trajectory reader so that
// swapping in a new trajectory frees the previous
// WASM-owned resources exactly once.
const appCleanups = new WeakMap<Molvis, () => void>();

/**
 * Deep-copy every non-`atoms` block (`bonds`, `angles`, `dihedrals`, …) of
 * `source` into a fresh, independently-owned {@link Frame}. `atoms` is dropped
 * on purpose — in the topology-preserving merge the positions come from the
 * trajectory, and this frame contributes only connectivity.
 *
 * `Frame.insertBlock` deep-copies the block's column data, so the returned
 * frame survives disposal of `source`'s trajectory (which
 * {@link Molvis.setTrajectory} performs when the trajectory is swapped). The
 * caller owns the returned frame and must `free()` it if it is not handed to a
 * {@link MemoryDataSource}.
 */
export function extractTopologyFrame(source: Frame): Frame {
  const topo = new Frame();
  for (const name of source.blockNames()) {
    if (name === "atoms") continue;
    const block = source.getBlock(name);
    if (block !== undefined && block.nrows() > 0) {
      topo.insertBlock(name, block);
    }
  }
  return topo;
}

/**
 * Whether the current scene is a single static structure carrying topology —
 * a one-frame timeline whose frame has a non-empty `bonds` block. This is the
 * "a `.data`/`.pdb` is open" precondition for the topology-preserving merge:
 * dropping a multi-frame trajectory onto such a scene keeps the bonds and
 * animates the positions.
 */
export function isStaticTopologyScene(
  frame: Frame | undefined,
  length: number,
): boolean {
  if (length !== 1 || frame === undefined) return false;
  const bonds = frame.getBlock("bonds");
  return bonds !== undefined && bonds.nrows() > 0;
}

/** Filename of the current head DataSourceModifier, if any. Read before a
 *  `setTrajectory` swap removes it, to label the re-housed topology source. */
function headDataSourceFilename(app: Molvis): string | undefined {
  return app.modifierPipeline
    .getModifiers()
    .find((m): m is DataSourceModifier => m instanceof DataSourceModifier)
    ?.filename;
}

/**
 * Install `trajectory` as the pipeline's single primary source (the
 * "replace" half of the synthesis model): register cleanup, swap the
 * trajectory, auto-attach Draw modifiers, run the optional bond-column
 * mapping prompt, rebuild, and reset the camera + mode. Shared by the
 * `"replace"`/`"auto"` paths and by {@link mergeTrajectoryOntoTopology}.
 */
async function installPrimaryTrajectory(
  app: Molvis,
  trajectory: Trajectory,
  dispose: () => void,
  filename: string,
  pickBondMapping?: PickBondMapping,
): Promise<void> {
  appCleanups.get(app)?.();
  appCleanups.delete(app);
  appCleanups.set(app, dispose);

  await app.setTrajectory(trajectory, { sourceType: "file", filename });

  // Auto-attach format-specific decoration modifiers (e.g. backbone ribbon)
  // based on the columns the freshly loaded frame carries, nested under the
  // DS that setTrajectory installed at pipeline head.
  const frame0 = app.system.frame;
  const headDS = app.modifierPipeline
    .getModifiers()
    .find((m): m is DataSourceModifier => m instanceof DataSourceModifier);
  if (frame0) applyAutoAttach(app.modifierPipeline, frame0, undefined, headDS);

  // OVITO-style bonds column mapping. Throws BondMappingCancelledError on
  // user-cancel — the outer load wrapper reports it as "cancelled".
  if (frame0 && headDS) {
    const mapping = await maybePromptBondMapping(
      frame0,
      filename,
      pickBondMapping,
    );
    if (mapping !== null) {
      attachBondMappingChildren(app, headDS, mapping);
    }
  }

  await app.applyPipeline({ fullRebuild: true });
  app.world.resetCamera();
  app.setMode("view");
}

/**
 * Make a dropped multi-frame `trajectory` the primary timeline while keeping
 * the bonds/angles of the structure already on screen. Implements the
 * "open `.data`, then drop `.lammpstrj`" workflow: positions and box come
 * from each trajectory frame; connectivity is broadcast from the original
 * topology so playback is a fast position-only update with bonds intact.
 *
 * The topology is deep-copied *before* `setTrajectory` frees the outgoing
 * trajectory's WASM frames, then re-installed as a length-1
 * {@link MemoryDataSource} that contributes only its non-`atoms` blocks. The
 * synthesis head merges them (augment, last-wins): the trajectory's `atoms`
 * win per frame, the topology's `bonds` ride along on every frame.
 *
 * Owns `trajectory` disposal: frees it on the atom-count guard, otherwise
 * transfers ownership to {@link installPrimaryTrajectory}.
 */
async function mergeTrajectoryOntoTopology(
  app: Molvis,
  trajectory: Trajectory,
  dispose: () => void,
  filename: string,
  pickBondMapping?: PickBondMapping,
): Promise<void> {
  const current = app.system.frame;
  const topoAtoms = current?.getBlock("atoms")?.nrows() ?? 0;

  // Positions are mapped onto the topology by atom row order; their counts
  // must agree or bonds would dangle. Fail loudly before tearing anything
  // down. (Row-order alignment is assumed; reordering LAMMPS dumps by `id`
  // to match the data file is a separate concern.)
  const probe = await trajectory.frame(0);
  const trajAtoms = probe.getBlock("atoms")?.nrows() ?? 0;
  if (topoAtoms > 0 && trajAtoms > 0 && topoAtoms !== trajAtoms) {
    dispose();
    throw new Error(
      `Cannot apply trajectory "${filename}" onto the current structure: the trajectory has ${trajAtoms} atom(s) but the loaded topology has ${topoAtoms}. Positions can only be mapped onto a topology with the same atom count (and matching atom order).`,
    );
  }

  // Capture topology + its source label BEFORE the swap disposes them.
  const topoFrame = current ? extractTopologyFrame(current) : new Frame();
  const topoFilename = headDataSourceFilename(app) ?? filename;

  // The dropped trajectory drives the timeline (positions + per-frame box).
  await installPrimaryTrajectory(
    app,
    trajectory,
    dispose,
    filename,
    pickBondMapping,
  );

  // Re-house the captured topology as a broadcast, connectivity-only overlay.
  const contributed = topoFrame.blockNames();
  if (contributed.length === 0) {
    topoFrame.free();
    return;
  }
  const topoDS = new MemoryDataSource(topoFrame, {
    filename: topoFilename,
    sourceType: "file",
    contributedBlocks: contributed,
  });
  await app.addDataSource(topoDS);
}

/**
 * Canonical file ingress for `@molvis/core`. Dispatches to the right
 * reader based on payload shape (string → text format, object → zarr),
 * stamps the pipeline head with a `DataSourceModifier`, swaps in the
 * new trajectory, and replays user-added modifiers on it. All file
 * entry points — page drag-drop, DataSource panel "Load File", vsc-ext
 * "Open Editor" / "Quick View" — converge here.
 */
export async function loadFileContent(
  app: Molvis,
  content: FileContent,
  filename: string,
  format?: FileFormat,
  mode: LoadMode = "replace",
  pickBondMapping?: PickBondMapping,
): Promise<void> {
  let trajectory: Trajectory;
  let dispose: () => void;

  if (typeof content === "string") {
    const bundle = loadTextTrajectory(content, filename, format);
    trajectory = bundle.trajectory;
    dispose = bundle.dispose;
  } else if (content instanceof Uint8Array) {
    const bundle = loadBinaryTrajectory(content, filename, format);
    trajectory = bundle.trajectory;
    dispose = bundle.dispose;
  } else {
    const bundle = loadZarrFiles(content);
    trajectory = bundle.trajectory;
    dispose = bundle.dispose;
  }

  // Topology-preserving merge: dropping a multi-frame trajectory onto a
  // single static structure that already carries bonds keeps the bonds and
  // animates the positions. Fires for both "auto" (drag-drop default) and
  // "append" (what used to throw a frame-count mismatch for this shape).
  if (
    (mode === "auto" || mode === "append") &&
    trajectory.length > 1 &&
    isStaticTopologyScene(app.system.frame, app.system.trajectory.length)
  ) {
    await mergeTrajectoryOntoTopology(
      app,
      trajectory,
      dispose,
      filename,
      pickBondMapping,
    );
    return;
  }

  if (mode === "append") {
    // Decision tree path: build the right kind of DataSourceModifier
    // and let MolvisApp.addDataSource handle frame-count validation,
    // System sync, and auto-attach. Errors propagate to the caller —
    // we dispose the trajectory on failure so we don't leak WASM.
    try {
      await appendTrajectoryAsDataSource(
        app,
        trajectory,
        { sourceType: "file", filename },
        pickBondMapping,
      );
    } catch (err) {
      dispose();
      throw err;
    }
    app.world.resetCamera();
    app.setMode("view");
    return;
  }

  // Replace path ("replace", and "auto" when no topology merge applies):
  // "Open File" / first-load behavior.
  await installPrimaryTrajectory(
    app,
    trajectory,
    dispose,
    filename,
    pickBondMapping,
  );
}

export interface LoadFileStreamOptions {
  /** Indexing-progress callback. Called periodically (≤10 Hz) during
   *  the worker's blocking index pass. Useful for status-bar updates. */
  onProgress?: IndexProgressCallback;
  /** Bytes per indexer chunk. Default 8 MiB. */
  chunkSize?: number;
}

export interface LoadFileStreamResult {
  /** The runtime the loader spawned. Hand off to UI for cancellation /
   *  later disposal. The caller does NOT need to call `runtime.close()`
   *  manually — the next file load (or `applyEmptyTrajectory`) disposes
   *  this one automatically through the registered cleanup. */
  runtime: TrajectoryRuntime;
}

/**
 * Streaming file ingress. Used for large text-format trajectories
 * (LAMMPS dump / XYZ / PDB / LAMMPS data / SDF). The original file is
 * never materialized as a JS string — a Dedicated Worker reads byte
 * ranges through `BlobRangeSource`, the molrs-wasm streaming reader
 * indexes / parses chunks, and frames flow back to the main thread one
 * at a time as transferable typed arrays.
 *
 * Returns once the indexing pass completes and frame 0 has been
 * materialized in `system.frame`. Auto-detect modifiers
 * (e.g. `BackboneRibbonModifier`) are attached against frame 0, the
 * pipeline is rebuilt, and the camera is reset.
 */
export async function loadFileStream(
  app: Molvis,
  file: Blob,
  filename: string,
  format: FileFormat,
  options: LoadFileStreamOptions = {},
  mode: LoadMode = "replace",
  pickBondMapping?: PickBondMapping,
): Promise<LoadFileStreamResult> {
  if (!canStream(format)) {
    throw new Error(
      `Format "${format}" cannot stream (descriptor.streaming = "eager-only"). Route this load through loadFileContent / loadFileSmart's eager path instead.`,
    );
  }
  // canStream narrows `format` to the worker's `Format` type, so
  // spawnTrajectoryWorker accepts it without a cast.
  const runtime = spawnTrajectoryWorker(format);
  const source = new BlobRangeSource(file);
  // Real Files have stable identity (size + lastModified) so we can
  // key the OPFS index sidecar against them. Network-fetched Blobs
  // come through `loadFileContent` (eager path) instead of this
  // streaming path, so this only fingerprints user-dropped files.
  const fingerprint =
    file instanceof File ? fingerprintFile(file, format) : undefined;

  // Indexing pass — blocking. Progress drains through the optional
  // callback; the caller surfaces it as a status-bar message. A
  // matching `.molidx` sidecar in OPFS short-circuits the scan
  // entirely.
  const { frameCount } = await runtime.open(source, {
    onProgress: options.onProgress,
    chunkSize: options.chunkSize,
    fingerprint,
  });

  const provider: AsyncFrameProvider = {
    length: frameCount,
    get: (index) => runtime.loadFrameLatest(index),
    dispose: () => {
      void runtime.close();
    },
  };
  const trajectory = Trajectory.fromAsyncProvider(provider);
  const streamDispose = () => {
    trajectory.dispose();
  };

  // Topology-preserving merge — same rule as the eager path: a multi-frame
  // trajectory dropped onto a single static structure with bonds animates
  // the positions while keeping the connectivity.
  if (
    (mode === "auto" || mode === "append") &&
    trajectory.length > 1 &&
    isStaticTopologyScene(app.system.frame, app.system.trajectory.length)
  ) {
    await mergeTrajectoryOntoTopology(
      app,
      trajectory,
      streamDispose,
      filename,
      pickBondMapping,
    );
    app.events.emit("status-message", {
      text: `Loaded ${frameCount} frame(s) from ${filename} onto current topology`,
      type: "info",
    });
    return { runtime };
  }

  if (mode === "append") {
    try {
      await appendTrajectoryAsDataSource(
        app,
        trajectory,
        { sourceType: "file", filename },
        pickBondMapping,
      );
    } catch (err) {
      streamDispose();
      throw err;
    }

    app.events.emit("status-message", {
      text: `Loaded ${frameCount} frame(s) from ${filename}`,
      type: "info",
    });
    app.world.resetCamera();
    app.setMode("view");
    return { runtime };
  }

  // Replace path ("replace", and "auto" when no topology merge applies).
  app.events.emit("status-message", {
    text: `Loaded ${frameCount} frame(s) from ${filename}`,
    type: "info",
  });
  await installPrimaryTrajectory(
    app,
    trajectory,
    streamDispose,
    filename,
    pickBondMapping,
  );
  return { runtime };
}
