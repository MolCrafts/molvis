import {
  type Frame,
  MrecReader,
  openMrecStore,
} from "@molcrafts/molvis-core/molrs";
import { type FrameProvider, Trajectory } from "../system/trajectory";
import { logger } from "../utils/logger";
import { MapMrecStoreHost, sectionUpdatesAt } from "./mrec_store";

/** Frames kept decoded around the playhead by the sync mrec provider. */
export const MREC_FRAME_CACHE_SIZE = 16;

export interface MrecLoadResult {
  trajectory: Trajectory;
  dispose: () => void;
}

/** Defer `task` until the main thread is idle (host-injectable for tests). */
export type IdleScheduler = (task: () => void) => void;

export interface MrecLoadOptions {
  /** LRU capacity in frames; defaults to {@link MREC_FRAME_CACHE_SIZE}. */
  cacheSize?: number;
  /** Readahead scheduler; defaults to `requestIdleCallback` / `setTimeout(0)`. */
  scheduleIdle?: IdleScheduler;
}

function defaultIdleScheduler(task: () => void): void {
  const ric = (
    globalThis as { requestIdleCallback?: (cb: () => void) => number }
  ).requestIdleCallback;
  if (typeof ric === "function") ric(task);
  else setTimeout(task, 0);
}

/**
 * Bounded frame LRU for the sync mrec provider: a hit promotes the entry to
 * most-recent, so back-and-forth scrubbing stops degenerating into FIFO.
 * Eviction only drops the JS reference — never `frame.free()` (the frame may
 * still be `_lastRenderedFrame` / bound in SceneIndex; see
 * `.claude/notes/molrs-handles.md`).
 */
export class MrecFrameCache {
  private readonly frames = new Map<number, Frame>();

  constructor(readonly capacity: number = MREC_FRAME_CACHE_SIZE) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new Error(
        `mrec frame cache capacity must be >= 1, got ${capacity}`,
      );
    }
  }

  get size(): number {
    return this.frames.size;
  }

  has(index: number): boolean {
    return this.frames.has(index);
  }

  /** Cached frame, promoted to most-recently-used. */
  get(index: number): Frame | undefined {
    const frame = this.frames.get(index);
    if (frame === undefined) return undefined;
    this.frames.delete(index);
    this.frames.set(index, frame);
    return frame;
  }

  /** Insert as most-recent; evicts the least-recent entry past capacity. */
  set(index: number, frame: Frame): void {
    this.frames.delete(index);
    this.frames.set(index, frame);
    while (this.frames.size > this.capacity) {
      const oldest = this.frames.keys().next().value as number | undefined;
      if (oldest === undefined) break;
      this.frames.delete(oldest);
    }
  }

  /** Remove every entry and hand them to the caller (teardown only). */
  drain(): Frame[] {
    const frames = [...this.frames.values()];
    this.frames.clear();
    return frames;
  }
}

/** One entry from a host directory listing of an mrec store. */
export interface MrecDirent {
  name: string;
  kind: "file" | "directory";
}

/**
 * Host I/O for an mrec directory store (a Zarr-v3 tree on disk).
 *
 * Paths are POSIX, relative to the store root, and never start with `/`.
 * `list("")` lists the store root. molrs `MrecReader` opens the store;
 * the host only supplies bytes.
 */
export interface MrecDirectorySource {
  list(path: string): Promise<readonly MrecDirent[]>;
  read(path: string): Promise<Uint8Array>;
}

function decodeBase64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function joinStorePath(parent: string, name: string): string {
  if (
    name.length === 0 ||
    name === "." ||
    name === ".." ||
    name.includes("/") ||
    name.includes("\\") ||
    name.includes("\0")
  ) {
    throw new Error(
      `mrec store entry name is not a single path segment: ${JSON.stringify(name)}`,
    );
  }
  return parent ? `${parent}/${name}` : name;
}

function storeRelativeKey(path: string, root: string): string {
  if (!root) return path;
  if (path === root) return "";
  const prefix = `${root}/`;
  return path.startsWith(prefix) ? path.slice(prefix.length) : path;
}

function trajectoryFromReader(
  reader: MrecReader,
  options: MrecLoadOptions = {},
): MrecLoadResult {
  const frameCount = reader.nFrames();
  const cache = new MrecFrameCache(options.cacheSize);
  const scheduleIdle = options.scheduleIdle ?? defaultIdleScheduler;
  let disposed = false;
  let readaheadScheduled = -1;

  const decode = (index: number): Frame => {
    const frame = reader.readFrame(index);
    if (!frame) throw new Error(`mrec frame ${index} out of range`);
    cache.set(index, frame);
    return frame;
  };

  // Playback is overwhelmingly forward: after serving `i`, decode `i + 1`
  // while the main thread is idle so the next `get` is a cache hit. One
  // readahead in flight at a time; a disposed reader is never touched.
  const scheduleReadahead = (index: number): void => {
    if (index >= frameCount || cache.has(index)) return;
    if (readaheadScheduled === index) return;
    readaheadScheduled = index;
    scheduleIdle(() => {
      if (readaheadScheduled === index) readaheadScheduled = -1;
      if (disposed || cache.has(index)) return;
      try {
        decode(index);
      } catch (error) {
        logger.warn(
          `[mrec] readahead of frame ${index} failed`,
          error as Error,
        );
      }
    });
  };

  // Store index seam: block name → CSR update id per frame, straight from
  // the reader (a binary search per block, no decode). `frame_diff` keeps a
  // "position" pass whenever every topology block's id is unchanged.
  const blockNames = reader.blockNames();
  const provider: FrameProvider = {
    length: frameCount,
    get(index: number): Frame {
      const frame = cache.get(index) ?? decode(index);
      scheduleReadahead(index + 1);
      return frame;
    },
    sectionUpdates(index: number) {
      if (disposed || index < 0 || index >= frameCount) return undefined;
      return sectionUpdatesAt(reader, blockNames, index);
    },
  };

  const trajectory = Trajectory.fromProvider(provider);

  // Teardown-only free. LRU eviction deliberately refuses to free a
  // mid-life frame (it races `_lastRenderedFrame` / SceneIndex), and this
  // closure must run only AFTER the scene has been swapped off these frames:
  // `installPrimaryTrajectory` (io/index.ts) defers the outgoing file's
  // cleanup until `replaceScene` has moved `_lastRenderedFrame` onto the
  // incoming trajectory, so by the time we free here no render can deref a
  // freed molrs handle. See `.claude/notes/molrs-handles.md`.
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    for (const frame of cache.drain()) frame.free();
    reader.free();
  };

  logger.info(`[mrec] Loaded ${frameCount} frame(s)`);
  return { trajectory, dispose };
}

/**
 * Load an mrec store already materialized as store-relative path → bytes.
 * Keys must not start with `/`. Backed by molrs `MrecReader`, opened
 * through a {@link MapMrecStoreHost} so the map stays the one resident copy
 * and only the byte ranges a frame decode touches cross into wasm.
 */
export function loadMrecStore(
  files: Map<string, Uint8Array>,
  options?: MrecLoadOptions,
): MrecLoadResult {
  if (files.size === 0) {
    throw new Error("mrec store is empty");
  }
  return trajectoryFromReader(
    openMrecStore(new MapMrecStoreHost(files)),
    options,
  );
}

/**
 * Load a packed `*.mrec.zip` from its bytes (`MrecReader.fromZip`).
 * Entries must be stored, not deflated — the reader refuses compressed
 * archives by name.
 */
export function loadMrecZip(
  bytes: Uint8Array,
  options?: MrecLoadOptions,
): MrecLoadResult {
  if (bytes.byteLength === 0) {
    throw new Error("mrec archive is empty");
  }
  return trajectoryFromReader(MrecReader.fromZip(bytes), options);
}

/**
 * A `*.mrec` store as a host hands it to the ingress, before any reader
 * exists. Three shapes, by what the host holds:
 *
 * - `files` — the whole store already in memory (VS Code extension host,
 *   molexp, a directory walked through {@link MrecDirectorySource}).
 * - `file-tree` — browser `File` handles of the store directory (File System
 *   Access API / drag-and-drop). The lazy path: inside the trajectory worker
 *   nothing but the touched chunks is ever read.
 * - `zip` — one packed `*.mrec.zip` file.
 */
export type MrecStoreInput =
  | { kind: "files"; files: Map<string, Uint8Array> }
  | { kind: "file-tree"; files: Map<string, File> }
  | { kind: "zip"; blob: Blob };

/** Structural check for the async list/read host shape. */
export function isMrecDirectorySource(
  value: MrecDirectorySource | MrecStoreInput,
): value is MrecDirectorySource {
  return (
    typeof (value as MrecDirectorySource).list === "function" &&
    typeof (value as MrecDirectorySource).read === "function"
  );
}

/** Bytes of a `Blob` as one packed `Uint8Array`. */
async function blobBytes(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}

/**
 * Read every `File` of a store into memory as store-relative path → bytes.
 * The main-thread fallback for the `file-tree` shape when no worker (and so
 * no `FileReaderSync`) is available.
 */
export async function readMrecFileTree(
  files: ReadonlyMap<string, File>,
): Promise<Map<string, Uint8Array>> {
  const out = new Map<string, Uint8Array>();
  for (const [key, file] of files) out.set(key, await blobBytes(file));
  return out;
}

/**
 * Open an {@link MrecStoreInput} on the main thread through the sync
 * provider. This is the no-worker fallback: the `file-tree` shape is read
 * whole here because only a worker can read `File`s synchronously.
 */
export async function loadMrecInput(
  input: MrecStoreInput,
  options?: MrecLoadOptions,
): Promise<MrecLoadResult> {
  switch (input.kind) {
    case "files":
      return loadMrecStore(input.files, options);
    case "file-tree":
      return loadMrecStore(await readMrecFileTree(input.files), options);
    case "zip":
      return loadMrecZip(await blobBytes(input.blob), options);
  }
}

/**
 * Load an mrec store supplied as a file-path → bytes map into a lazy
 * Trajectory backed by molrs's MrecReader. Values are raw `Uint8Array`
 * bytes; base64 `string` values are still decoded for hosts that have not
 * moved off the text transport. The returned `dispose` frees the reader and
 * its frame cache; the io ingress calls it after swapping in the next
 * trajectory.
 */
export function loadMrecFiles(
  files: Record<string, Uint8Array | string>,
): MrecLoadResult {
  return loadMrecStore(mrecFilesFromRecord(files));
}

/**
 * Normalize a host `path → bytes | base64` record into the store map every
 * mrec door takes. Base64 `string` values are decoded for hosts still on the
 * text transport.
 */
export function mrecFilesFromRecord(
  files: Record<string, Uint8Array | string>,
): Map<string, Uint8Array> {
  const fileMap = new Map<string, Uint8Array>();
  for (const [filePath, content] of Object.entries(files)) {
    fileMap.set(
      filePath,
      typeof content === "string" ? decodeBase64ToBytes(content) : content,
    );
  }
  return fileMap;
}

/**
 * Recursively read an {@link MrecDirectorySource} into store-relative path → bytes.
 * `root` is listed first; keys are relative to that root.
 */
export async function collectMrecDirectory(
  source: MrecDirectorySource,
  root = "",
): Promise<Map<string, Uint8Array>> {
  const files = new Map<string, Uint8Array>();

  const visit = async (rel: string): Promise<void> => {
    const entries = await source.list(rel);
    for (const entry of entries) {
      const path = joinStorePath(rel, entry.name);
      if (entry.kind === "directory") {
        await visit(path);
        continue;
      }
      const key = storeRelativeKey(path, root);
      if (!key) continue;
      files.set(key, await source.read(path));
    }
  };

  await visit(root);
  if (files.size === 0) {
    throw new Error("mrec store is empty");
  }
  return files;
}

/**
 * Open an mrec directory source through molrs `MrecReader`.
 * The host lists and reads; this function walks the tree and decodes frames.
 */
export async function loadMrecDirectory(
  source: MrecDirectorySource,
  root = "",
): Promise<MrecLoadResult> {
  return loadMrecStore(await collectMrecDirectory(source, root));
}

/**
 * @deprecated Renamed to {@link MrecLoadResult} — mrec is the product, zarr
 * the encoding. Kept for one deprecation window; will be removed.
 */
export type ZarrLoadResult = MrecLoadResult;

/**
 * @deprecated Renamed to {@link MrecDirent}. Kept for one deprecation window.
 */
export type ZarrDirent = MrecDirent;

/**
 * @deprecated Renamed to {@link MrecDirectorySource}. Kept for one deprecation
 * window.
 */
export type ZarrDirectorySource = MrecDirectorySource;

/**
 * @deprecated Renamed to {@link loadMrecStore}. Kept for one deprecation window.
 */
export const loadZarrStore = loadMrecStore;

/**
 * @deprecated Renamed to {@link loadMrecFiles}. Kept for one deprecation window.
 */
export const loadZarrFiles = loadMrecFiles;

/**
 * @deprecated Renamed to {@link collectMrecDirectory}. Kept for one deprecation
 * window.
 */
export const collectZarrDirectory = collectMrecDirectory;

/**
 * @deprecated Renamed to {@link loadMrecDirectory}. Kept for one deprecation
 * window.
 */
export const loadZarrDirectory = loadMrecDirectory;
