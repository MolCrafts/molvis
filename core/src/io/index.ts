import type { MolvisApp as Molvis } from "../app";
import { applyAutoAttach } from "../pipeline/auto_attach";
import { type AsyncFrameProvider, Trajectory } from "../system/trajectory";
import { ensureDataSource } from "../transport/rpc/router";
import {
  type IndexProgressCallback,
  type TrajectoryRuntime,
  spawnTrajectoryWorker,
} from "../transport/trajectory_worker";
import { fingerprintFile } from "./cache";
import { type FileFormat, loadTextTrajectory, readFrames } from "./reader";
import { BlobRangeSource } from "./sources";
import { loadZarrFiles } from "./zarr";

export {
  describeFormat,
  type FileFormat,
  type FileFormatDescriptor,
  FILE_FORMAT_REGISTRY,
  getAllAcceptExtensions,
  inferFormatFromFilename,
  loadTextTrajectory,
  readFrames,
} from "./reader";
export { BlobRangeSource, type TrajectorySource } from "./sources";
export { loadZarrFiles, type ZarrLoadResult } from "./zarr";
export {
  defaultExtensionForFormat,
  exportFrame,
  type ExportFormat,
  type ExportPayload,
  mimeForFormat,
  writeFrame,
  type WriteFrameOptions,
  writeLAMMPSData,
  writePDBFrame,
  writeXYZFrame,
} from "./writer";

/**
 * Payload shape accepted by {@link loadFileContent}. A string is a text
 * format (.pdb/.xyz/.lammps/.dump/etc.); an object is a zarr directory
 * serialized as `filePath → base64` pairs.
 */
export type FileContent = string | Record<string, string>;

// Tracks per-app cleanup for the active lazy trajectory reader so that
// swapping in a new trajectory frees the previous
// WASM-owned resources exactly once.
const appCleanups = new WeakMap<Molvis, () => void>();

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
): Promise<void> {
  appCleanups.get(app)?.();
  appCleanups.delete(app);

  ensureDataSource(app, { sourceType: "file", filename });

  let trajectory: Trajectory;

  if (typeof content === "string") {
    const bundle = loadTextTrajectory(content, filename, format);
    trajectory = bundle.trajectory;
    appCleanups.set(app, bundle.dispose);
  } else {
    const bundle = loadZarrFiles(content);
    trajectory = bundle.trajectory;
    appCleanups.set(app, bundle.dispose);
  }

  await app.setTrajectory(trajectory);

  // Auto-attach format-specific decoration modifiers (e.g. backbone
  // ribbon for protein-shape frames) based on what columns the freshly
  // loaded frame actually carries. Replaces the old in-loader
  // `decorateFrame` side effect; modifiers are visible to the user and
  // can be removed.
  const frame0 = app.system.frame;
  if (frame0) applyAutoAttach(app.modifierPipeline, frame0);

  await app.applyPipeline({ fullRebuild: true });
  app.world.resetCamera();

  app.setMode("view");
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
): Promise<LoadFileStreamResult> {
  appCleanups.get(app)?.();
  appCleanups.delete(app);

  ensureDataSource(app, { sourceType: "file", filename });

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
    get: (index) => runtime.loadFrame(index),
    dispose: () => {
      void runtime.close();
    },
  };
  const trajectory = Trajectory.fromAsyncProvider(provider);

  appCleanups.set(app, () => {
    trajectory.dispose();
  });

  await app.setTrajectory(trajectory);

  const frame0 = app.system.frame;
  if (frame0) applyAutoAttach(app.modifierPipeline, frame0);

  app.events.emit("status-message", {
    text: `Loaded ${frameCount} frame(s) from ${filename}`,
    type: "info",
  });

  await app.applyPipeline({ fullRebuild: true });
  app.world.resetCamera();

  app.setMode("view");
  return { runtime };
}
