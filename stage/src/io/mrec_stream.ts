/**
 * Main-thread side of mrec-in-the-worker: turn an {@link MrecStoreInput}
 * into the store handle the worker opens, and wrap an opened runtime as an
 * async {@link Trajectory}.
 *
 * The worker owns the molrs `MrecReader`; the main thread never sees
 * store bytes after posting them. Frames arrive as transferable payloads and
 * each carries its section update ids, which the trajectory exposes through
 * `sectionUpdates(index)` for the change classifier.
 *
 * `TrajectoryRuntime` is injected so this module is green with a fake worker
 * (`spawnTrajectoryWorker` is the host's job — see `io/index.ts`).
 */

// Package self-reference on purpose (same as `io/index.ts`): the runtime
// `spawnTrajectoryWorker` hands back is typed from the dist-backed
// `./trajectory-runtime` subpath, and `TrajectoryRuntime` is nominal (private
// members), so this module must name the same declaration.
import {
  type Frame,
  readMrecFrameBytes,
  readMrecFrameFiles,
} from "@molcrafts/molvis-core/molrs";
import type { TrajectoryRuntime } from "@molcrafts/molvis-stage/trajectory-runtime";
import { type AsyncFrameProvider, Trajectory } from "../system/trajectory";
import type { MrecSourceHandle } from "../transport/trajectory_worker";
import type { MrecLoadResult, MrecStoreInput } from "./zarr";

/** Packed `ArrayBuffer` of a `Uint8Array`, copying only when it is a view. */
function packedBuffer(bytes: Uint8Array): ArrayBuffer {
  if (
    bytes.byteOffset === 0 &&
    bytes.byteLength === bytes.buffer.byteLength &&
    bytes.buffer instanceof ArrayBuffer
  ) {
    return bytes.buffer;
  }
  return bytes.slice().buffer as ArrayBuffer;
}

/**
 * The worker handle for `input`. `files` become one transferable buffer per
 * key (the caller's arrays are detached once posted), `file-tree` posts the
 * `File` handles themselves, and a `zip` is read whole here — asynchronously,
 * off the render path — then transferred.
 */
export async function mrecSourceHandleFor(
  input: MrecStoreInput,
): Promise<MrecSourceHandle> {
  switch (input.kind) {
    case "files": {
      const files = new Map<string, ArrayBuffer>();
      for (const [key, bytes] of input.files)
        files.set(key, packedBuffer(bytes));
      return { kind: "mrec-files", files };
    }
    case "file-tree":
      return { kind: "mrec-file-tree", files: new Map(input.files) };
    case "zip":
      return { kind: "mrec-zip", bytes: await input.blob.arrayBuffer() };
  }
}

/**
 * Open `input` on `runtime` (an `"mrec"` trajectory runtime) and wrap it as
 * an async trajectory. The returned `dispose` tears the trajectory down,
 * which closes the runtime through the provider hook; on an open failure the
 * runtime is closed here and the error propagates.
 */
export async function openMrecTrajectory(
  runtime: TrajectoryRuntime,
  input: MrecStoreInput,
): Promise<MrecLoadResult> {
  let opened: Awaited<ReturnType<TrajectoryRuntime["openStore"]>>;
  try {
    opened = await runtime.openStore(await mrecSourceHandleFor(input));
  } catch (error) {
    void runtime.close();
    throw error;
  }
  const provider: AsyncFrameProvider = {
    length: opened.frameCount,
    get: (index) => runtime.loadFrameLatest(index),
    sectionUpdates: (index) => runtime.sectionUpdates(index),
    dispose: () => {
      void runtime.close();
    },
  };
  const trajectory = Trajectory.fromAsyncProvider(provider);
  return { trajectory, dispose: () => trajectory.dispose() };
}

/**
 * The record's `frame` section, or `undefined` when it carries none.
 *
 * A record is a package: `meta` plus any of `frame`, `system`, `trajectory`.
 * The sections are independent — a run may write the topology once as `frame`
 * and the coordinates over time as `trajectory` — so this reads **only** the
 * one it is asked for. `MrecReader` answers about the sequence and
 * nothing else; between them the caller can open a record of either shape, or
 * of both.
 *
 * The returned `Frame` is a live molrs handle and belongs to the caller.
 */
export async function readMrecFrameSection(
  input: MrecStoreInput,
): Promise<Frame | undefined> {
  return input.kind === "zip"
    ? readMrecFrameBytes(new Uint8Array(await input.blob.arrayBuffer()))
    : readMrecFrameFiles(await storeBytes(input, isFrameSectionKey));
}

/**
 * The record's snapshot as a one-frame trajectory, or `undefined` when it
 * carries no `frame` section.
 *
 * A `*.mrec` record is a package: `meta` plus any of a snapshot (`frame`), a
 * topology (`system`) or a sequence (`trajectory`). `MrecReader` reads
 * the sequence, so a record written by `write_frame` — what molpack emits for
 * a packed configuration — opens as a sequence of length zero, which is a
 * scene with nothing in it and no error to explain why. This reads what such
 * a record does carry, so it can be shown.
 */
export async function openMrecFrameRecord(
  input: MrecStoreInput,
): Promise<MrecLoadResult | undefined> {
  const frame = await readMrecFrameSection(input);
  if (!frame) return undefined;
  const trajectory = new Trajectory([frame]);
  return { trajectory, dispose: () => trajectory.dispose() };
}

/**
 * The record's top-level groups, read from the store's **keys alone**.
 *
 * Free, and it has to be: the alternative — open it and see — costs a decode
 * of the whole record, and for a sequence store that is the entire point of
 * not doing it. A directory store's node layout is already spelled out in the
 * key set (`frame/atoms/x/zarr.json` → `frame`), so the shape is known before
 * a single byte is parsed.
 *
 * Empty for a packed `*.mrec.zip`, whose keys are inside the archive.
 */
export function mrecStoreGroups(input: MrecStoreInput): Set<string> {
  if (input.kind === "zip") return new Set();
  const groups = new Set<string>();
  for (const key of input.files.keys()) {
    const slash = key.indexOf("/");
    if (slash > 0) groups.add(key.slice(0, slash));
  }
  return groups;
}

/**
 * Keys the snapshot reader needs: store root, `meta/`, and `frame/`.
 * Trajectory shards stay on disk — they are the worker's job.
 */
function isFrameSectionKey(key: string): boolean {
  return (
    key === "zarr.json" ||
    key === "meta" ||
    key.startsWith("meta/") ||
    key === "frame" ||
    key.startsWith("frame/")
  );
}

/** Every file of a directory-shaped store as bytes. */
async function storeBytes(
  input: Exclude<MrecStoreInput, { kind: "zip" }>,
  keys?: (key: string) => boolean,
): Promise<Map<string, Uint8Array>> {
  const keep = keys ?? (() => true);
  if (input.kind === "files") {
    if (keys === undefined) return input.files;
    const filtered = new Map<string, Uint8Array>();
    for (const [key, bytes] of input.files) {
      if (keep(key)) filtered.set(key, bytes);
    }
    return filtered;
  }
  const files = new Map<string, Uint8Array>();
  for (const [key, file] of input.files) {
    if (!keep(key)) continue;
    files.set(key, new Uint8Array(await file.arrayBuffer()));
  }
  return files;
}
