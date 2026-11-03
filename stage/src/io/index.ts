import type { Frame } from "@molcrafts/molvis-core/molrs";
// The package self-reference (not a relative path) is deliberate: the
// worker-spawner subpath is the one specifier host builds alias to swap
// the spawn implementation (VS Code webview). TrajectoryRuntime's type
// comes from the same dist-backed surface so the spawned runtime and the
// declared result share one nominal class.
import type { TrajectoryRuntime } from "@molcrafts/molvis-stage/trajectory-runtime";
import { spawnTrajectoryWorker } from "@molcrafts/molvis-stage/worker-spawner";
import type { MolvisApp as Molvis } from "../app";
import type { ModifierPipeline } from "../pipeline";
import { applyAutoAttach } from "../pipeline/auto_attach";
import {
  type BondColumnMapping,
  BondColumnRemapModifier,
  bondsIntegerColumns,
  bondsNeedColumnMapping,
  inferBondColumnMapping,
} from "../pipeline/bond_column_remap";
import {
  DataSource,
  FileDataSource,
  MemoryDataSource,
} from "../pipeline/data_source";
import { DrawBondModifier } from "../pipeline/draw_bond";
import { MeshOverlayModifier } from "../pipeline/mesh_overlay";
import {
  type CompositionSource,
  compatibleAugmentLengths,
  extendSourcesToTrajectory,
} from "../system/source_composition";
import { type AsyncFrameProvider, Trajectory } from "../system/trajectory";
import {
  CancellationError,
  type IndexProgressCallback,
} from "../transport/trajectory_worker";
import { fingerprintFile } from "./cache";
import {
  mrecStoreGroups,
  openMrecTrajectory,
  readMrecFrameSection,
} from "./mrec_stream";
import {
  canStream,
  dropLoadMode,
  type FileFormat,
  loadBinaryTrajectory,
  loadTextTrajectory,
} from "./reader";
import { BlobRangeSource, type TrajectorySource } from "./sources";
import { parseStl } from "./stl";
import {
  collectMrecDirectory,
  isMrecDirectorySource,
  loadMrecInput,
  type MrecDirectorySource,
  type MrecStoreInput,
  mrecFilesFromRecord,
} from "./zarr";

export { CancellationError } from "../transport/trajectory_worker";
export {
  BOX_MIN_DRAW_LENGTH,
  BOX_ZERO_EPS,
  hasPresentBox,
  normalizeFrameBox,
  shouldDrawBox,
} from "./box_presence";
export {
  type CachedIndex,
  type CachedIndexInput,
  decideMolidxUse,
  decodeMolidx,
  encodeMolidx,
  type FrameIndexLike,
  MOLIDX_VERSION,
  OpfsIndexCache,
} from "./cache";
export {
  FileTreeMrecStoreHost,
  MapMrecStoreHost,
  sectionUpdatesAt,
} from "./mrec_store";
export { mrecSourceHandleFor, openMrecTrajectory } from "./mrec_stream";
export {
  canStream,
  decideIngest,
  describeFormat,
  dropLoadMode,
  extractMessage,
  FILE_FORMAT_REGISTRY,
  type FileFormat,
  type FileFormatDescriptor,
  type FormatPayload,
  getAllAcceptExtensions,
  type IngestDecision,
  type IngestKind,
  inferFormatFromFilename,
  ingestKind,
  isBinaryFormat,
  isStlPath,
  isStreamingOnly,
  loadBinaryTrajectory,
  loadTextTrajectory,
  readFrames,
  STL_SUFFIX,
  STREAMING_FILE_THRESHOLD_BYTES,
  type StreamingCapability,
  sniffFormatFromTextHead,
  TRAJECTORY_WHOLE_FILE_CAP_BYTES,
  toIoError,
  wholeFileTrajectoryReason,
} from "./reader";
export {
  BlobRangeSource,
  HostRangeSource,
  type TrajectorySource,
} from "./sources";
export { parseStl, StlParseError } from "./stl";
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
} from "./writer";
export {
  collectMrecDirectory,
  // Deprecated encoding-named aliases (one window); prefer the mrec* names.
  collectZarrDirectory,
  isMrecDirectorySource,
  loadMrecDirectory,
  loadMrecFiles,
  loadMrecInput,
  loadMrecStore,
  loadMrecZip,
  loadZarrDirectory,
  loadZarrFiles,
  loadZarrStore,
  type MrecDirectorySource,
  type MrecDirent,
  type MrecLoadResult,
  type MrecStoreInput,
  mrecFilesFromRecord,
  readMrecFileTree,
  type ZarrDirectorySource,
  type ZarrDirent,
  type ZarrLoadResult,
} from "./zarr";

/**
 * Payload shape accepted by {@link loadFileContent}.
 *
 * - `string` — a text-format file body (PDB/XYZ/LAMMPS/SDF/…). The
 *   resolved descriptor must declare `payload: "text"`.
 * - `Uint8Array` — raw bytes for a binary-format file. DCD, TRR, and XTC
 *   declare `payload: "binary"`; `loadFileContent` dispatches them to
 *   `loadBinaryTrajectory`.
 * - `Record<string, Uint8Array | string>` — an mrec store as
 *   `filePath → bytes` pairs (base64 `string` values still accepted).
 *
 * The discriminator at runtime is structural: `typeof === "string"`
 * for text, `instanceof Uint8Array` for binary, otherwise an mrec store.
 */
export type FileContent =
  | string
  | Uint8Array
  | Record<string, Uint8Array | string>;

/**
 * Drop occupancy for a live pipeline: DataSources plus Mesh overlays.
 * An STL-only scene is occupied — the next structure/trajectory augments.
 */
export function sceneDropLoadMode(
  pipeline: Pick<ModifierPipeline, "sources" | "meshOverlayCount">,
): "replace" | "augment" {
  return dropLoadMode(pipeline.sources().length, pipeline.meshOverlayCount());
}

/**
 * How a file ingress combines with the existing system.
 *
 * - `"replace"` clears the scene and installs the file as one source.
 * - `"augment"` adds the file as another source in the augment composition.
 * - `"extend"` concatenates the current source set and this file at load time,
 *   then replaces the scene with the extended result as one ordinary source.
 */
export type LoadMode = "replace" | "augment" | "extend";

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
 * {@link DataSource}, and add it via
 * {@link Molvis.addDataSource}. Throws on frame-count or block-type
 * mismatch with concrete numbers; the caller is expected to surface
 * the error to the user (e.g. via a status-message event).
 *
 * Does NOT dispose `trajectory` on its own. On error path, ownership
 * stays with the caller so they decide whether to retry / free.
 */
async function augmentTrajectoryAsDataSource(
  app: Molvis,
  trajectory: Trajectory,
  meta: {
    filename: string;
    sourceType: DataSource["sourceType"];
  },
  pickBondMapping?: PickBondMapping,
): Promise<void> {
  const N_file = trajectory.length ?? trajectory.indexedLength;
  const existingTraj = app.modifierPipeline
    .sources()
    .find((m): m is FileDataSource => m instanceof FileDataSource);

  const probeFrame = await trajectory.frame(0);

  // Block-type consistency: if both the existing system and the new file
  // contribute an `atoms` block, their atom counts must match — bonds /
  // selections downstream key off atom indices, and a silent atom-count
  // change would dangle them.
  const currentAtoms = app.system.frame?.has("atoms")
    ? app.system.frame.get("atoms")
    : undefined;
  const currentAtomCount = currentAtoms?.nRows ?? 0;
  if (currentAtomCount > 0) {
    const probeAtoms = probeFrame.has("atoms")
      ? probeFrame.get("atoms")
      : undefined;
    if (probeAtoms !== undefined && probeAtoms.nRows !== currentAtomCount) {
      throw new Error(
        `Cannot augment "${meta.filename}": file has ${probeAtoms.nRows} atom(s); existing system has ${currentAtomCount}. Augment sources must agree on atom count when both files contribute an atoms block. To concatenate two structures, use Extend trajectory…`,
      );
    }
  }

  // OVITO-style column mapping. If the bonds block exists but lacks the
  // canonical `atomi`/`atomj` columns, prompt the host for a mapping;
  // a `null` reply aborts the whole augment load. Performed before constructing
  // the DS so a user-cancel doesn't leave a half-attached DS in the pipe.
  const mapping = await maybePromptBondMapping(
    app,
    probeFrame,
    meta.filename,
    pickBondMapping,
  );

  let ds: DataSource;
  if (N_file <= 1) {
    // Single-frame file → MemoryDataSource. Broadcasts across whatever
    // trajectory length the pipeline already has (or stays at 1 if
    // there's no trajectory yet). `contributedBlocks` defaults to empty
    // → composition propagates every block the frame actually has.
    ds = new MemoryDataSource(probeFrame, meta);
  } else if (compatibleAugmentLengths(existingTraj?.frameCount, N_file)) {
    // Multi-frame file: primary when none exists, stacks onto a
    // length-1 structure (topology + DCD), or onto an equal-length
    // trajectory. Unequal multi-frame lengths throw.
    ds = new FileDataSource(trajectory, meta);
  } else {
    throw new Error(
      `Cannot augment "${meta.filename}": file has ${N_file} frame(s); existing trajectory has ${existingTraj?.frameCount}. File must be single-frame or match existing frame count.`,
    );
  }

  await app.addDataSource(ds);

  if (mapping !== null) {
    attachBondMappingChildren(app, ds, mapping);
    // The remap + DrawBond modifiers were added after addDataSource's
    // built-in applyPipeline ran, so re-run once more so they take
    // effect on the same load tick.
    await app.applyPipeline({ fullRebuild: true });
  }
}

/**
 * Probe `frame` for an unmapped bonds block and resolve how to map its
 * columns onto the canonical `atomi`/`atomj` schema — by inference when the
 * endpoints are unambiguous, otherwise by asking the host through
 * `pickBondMapping`.
 *
 * Returns:
 * - `null` — nothing to map (no bonds block, already canonical, or not
 *   enough integer columns to map) or no way to map it. Caller proceeds
 *   without a remap.
 * - {@link BondColumnMapping} — inferred or user-confirmed. Caller attaches
 *   a {@link BondColumnRemapModifier} downstream of the DS.
 *
 * A host that renders its own picker passes one; a host that mounts the
 * stage's chrome instead (`molvis-viewer`, the VS Code webview) falls back to
 * the stage's own dialog. Only a host with neither — headless, or
 * `showUI: false` — gets a status message rather than a scene that silently
 * draws no bonds.
 *
 * Throws a `BondMappingCancelledError` when the picker returns `null` —
 * the caller catches it and aborts the load with a "cancelled" status.
 */
async function maybePromptBondMapping(
  app: Molvis,
  frame: Frame,
  filename: string,
  pickBondMapping: PickBondMapping | undefined,
): Promise<BondColumnMapping | null> {
  if (!bondsNeedColumnMapping(frame)) return null;
  // A `dump local` overlay names its endpoints the way molrs writes them, so
  // there is nothing for the user to choose. Inferring here is what makes the
  // canonical `*.dump.local` drop render on every host, dialog or not.
  const inferred = inferBondColumnMapping(frame);
  if (inferred !== null) return inferred;
  const candidates = bondsIntegerColumns(frame);
  if (candidates.length < 2) return null;

  const gui = app.guiIfMounted;
  const prompt: PickBondMapping | undefined =
    pickBondMapping ??
    (gui?.canPrompt
      ? (name, columns) => gui.pickBondMapping(name, columns)
      : undefined);
  if (!prompt) {
    app.events.emit("status-message", {
      text: `${filename}: bonds loaded but not drawn — endpoint columns (${candidates.join(", ")}) are not molvis's atomi/atomj, and this host cannot ask which to use.`,
      type: "warning",
    });
    return null;
  }
  const decision = await prompt(filename, candidates);
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
  ds: DataSource,
  mapping: BondColumnMapping,
): void {
  const remap = new BondColumnRemapModifier("bond-column-remap", mapping);
  app.modifierPipeline.addModifier(remap);
  app.modifierPipeline.setSourceOwner(remap.id, ds.id);

  const drawBond = new DrawBondModifier();
  app.modifierPipeline.addModifier(drawBond);
  app.modifierPipeline.setSourceOwner(drawBond.id, ds.id);
}

function remapTrajectoryBonds(
  trajectory: Trajectory,
  mapping: BondColumnMapping,
): Trajectory {
  const remap = new BondColumnRemapModifier(
    "loader-extend-bond-remap",
    mapping,
  );
  return Trajectory.fromAsyncProvider({
    length: trajectory.requireCompleteLength("remap-bonds"),
    get: async (index) =>
      (await remap.apply(await trajectory.frame(index), {} as never)) as Frame,
  });
}

// Tracks per-app cleanup for the active lazy trajectory reader so that
// swapping in a new trajectory frees the previous
// WASM-owned resources exactly once.
const appCleanups = new WeakMap<Molvis, () => void>();

/** In-flight {@link loadFileStream} worker cleanups — not yet committed to the pipeline. */
const streamInFlightCleanups = new WeakMap<Molvis, () => void>();

function disposeInFlightStream(app: Molvis): void {
  const cleanup = streamInFlightCleanups.get(app);
  if (!cleanup) return;
  streamInFlightCleanups.delete(app);
  cleanup();
}

/**
 * Release the parser/reader resources owned by the active
 * {@link loadFileContent} call for `app`.
 *
 * MolvisApp calls this during destruction; it is also public for lightweight
 * hosts that own an app-like lifecycle without replacing the active scene.
 * Calling it more than once is safe.
 */
export function disposeLoadedFile(app: Molvis): void {
  const cleanup = appCleanups.get(app);
  if (!cleanup) return;
  appCleanups.delete(app);
  cleanup();
  disposeInFlightStream(app);
}

/**
 * Install `trajectory` as the pipeline's single primary source (the
 * replace-scene path: register cleanup, swap the
 * trajectory, auto-attach Draw modifiers, run the optional bond-column
 * mapping prompt, rebuild, and reset the camera + mode.
 */
async function installPrimaryTrajectory(
  app: Molvis,
  trajectory: Trajectory,
  dispose: () => void,
  filename: string,
  pickBondMapping?: PickBondMapping,
): Promise<void> {
  disposeInFlightStream(app);
  // Defer the OUTGOING file's cleanup until AFTER replaceScene has swapped
  // `_lastRenderedFrame` onto the incoming trajectory. Freeing first (the old
  // order) let a render scheduled against the previous frame deref a
  // just-freed molrs handle — a wasm null-ptr trap. The reader/mrec dispose
  // closures free their whole frame cache, so this ordering is what keeps
  // that free safe. See `.claude/notes/molrs-handles.md`.
  const previousCleanup = appCleanups.get(app);
  appCleanups.delete(app);
  appCleanups.set(app, dispose);

  await app.replaceScene(trajectory, { sourceType: "file", filename });

  previousCleanup?.();

  // replaceScene already auto-attached the default Draws (Particles/Bonds/…)
  // and, on a running app, rendered them. Both steps below are idempotent, so
  // the scene is rebuilt again only when one of them actually adds a modifier
  // — a second full rebuild costs another whole scene build on a large frame.
  const frame0 = app.system.frame;
  const headDS = app.modifierPipeline
    .sources()
    .find((m): m is DataSource => m instanceof DataSource);
  const attached = frame0
    ? applyAutoAttach(app.modifierPipeline, frame0, undefined, headDS)
    : [];
  let pipelineChanged = attached.length > 0;

  // OVITO-style bonds column mapping. Throws BondMappingCancelledError on
  // user-cancel — the outer load wrapper reports it as "cancelled".
  if (frame0 && headDS) {
    const mapping = await maybePromptBondMapping(
      app,
      frame0,
      filename,
      pickBondMapping,
    );
    if (mapping !== null) {
      attachBondMappingChildren(app, headDS, mapping);
      pipelineChanged = true;
    }
  }

  if (pipelineChanged || !app.isRunning) {
    await app.applyPipeline({ fullRebuild: true });
  }
  app.world.fit();
  app.setMode("view");
}

async function extendIntoScene(
  app: Molvis,
  trajectory: Trajectory,
  dispose: () => void,
  filename: string,
  pickBondMapping?: PickBondMapping,
): Promise<void> {
  const existingSources: CompositionSource[] = app.modifierPipeline
    .sources()
    .filter(
      (modifier): modifier is DataSource =>
        modifier instanceof DataSource && modifier.enabled,
    )
    .map((source) => ({
      id: source.id,
      trajectory: source.trajectory,
      contributedBlocks:
        source.contributedBlocks.length > 0
          ? source.contributedBlocks
          : undefined,
    }));

  if (existingSources.length === 0) {
    await installPrimaryTrajectory(
      app,
      trajectory,
      dispose,
      filename,
      pickBondMapping,
    );
    return;
  }

  const mapping = await maybePromptBondMapping(
    app,
    await trajectory.frame(0),
    filename,
    pickBondMapping,
  );
  const incoming = mapping
    ? remapTrajectoryBonds(trajectory, mapping)
    : trajectory;
  const extended = await extendSourcesToTrajectory([
    ...existingSources,
    { id: "incoming", trajectory: incoming },
  ]);

  dispose();
  await installPrimaryTrajectory(
    app,
    extended,
    () => extended.dispose(),
    filename,
    pickBondMapping,
  );
}

async function commitLoadedTrajectory(
  app: Molvis,
  trajectory: Trajectory,
  dispose: () => void,
  filename: string,
  mode: LoadMode,
  pickBondMapping?: PickBondMapping,
): Promise<void> {
  if (mode === "extend") {
    await extendIntoScene(app, trajectory, dispose, filename, pickBondMapping);
    return;
  }

  if (mode === "augment") {
    try {
      await augmentTrajectoryAsDataSource(
        app,
        trajectory,
        { sourceType: "file", filename },
        pickBondMapping,
      );
    } catch (err) {
      dispose();
      throw err;
    }
    app.world.fit();
    app.setMode("view");
    return;
  }

  await installPrimaryTrajectory(
    app,
    trajectory,
    dispose,
    filename,
    pickBondMapping,
  );
}

/**
 * Phase reporter for one file load.
 *
 * Every phase goes out as a `status-message`, which the app mirrors to the
 * console (`app.ts` status-message handler) — so hosts get a visible line and
 * a log entry from one emit, and there is no second logging path to keep in
 * sync.
 */
class LoadReport {
  private readonly started = performance.now();
  private parsedAt: number | null = null;

  constructor(
    private readonly app: Molvis,
    private readonly filename: string,
    private readonly byteLength: number | undefined,
  ) {}

  /** Announce the parse before it blocks the thread on a large payload. */
  parsing(format: FileFormat | undefined): void {
    const size =
      this.byteLength !== undefined ? ` (${megabytes(this.byteLength)})` : "";
    const kind = format ? ` ${format}` : "";
    this.say(`Reading ${this.filename}${size}${kind}…`);
  }

  /** The reader is open; the scene build is what remains. */
  parsed(): void {
    this.parsedAt = performance.now();
    this.say(`Building scene from ${this.filename}…`);
  }

  /** Scene is on the GPU. Reports the split so a slow stage is identifiable. */
  done(): void {
    const now = performance.now();
    const parse = (this.parsedAt ?? now) - this.started;
    const scene = now - (this.parsedAt ?? now);
    const frame = this.app.system.frame;
    const atoms = frame?.has("atoms") ? frame.get("atoms").nRows : 0;
    const bonds = frame?.has("bonds") ? frame.get("bonds").nRows : 0;
    const frames = this.app.system.trajectory.indexedLength;
    this.say(
      `${this.filename}: ${atoms} atoms, ${bonds} bonds, ${frames} frame(s)` +
        ` — read ${seconds(parse)}, scene ${seconds(scene)}, total ${seconds(now - this.started)}`,
      "success",
    );
  }

  private say(text: string, type: "info" | "success" = "info"): void {
    this.app.events.emit("status-message", { text, type });
  }
}

function megabytes(byteLength: number): string {
  return `${(byteLength / (1024 * 1024)).toFixed(1)} MB`;
}

function seconds(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`;
}

/**
 * Data-file ingress for `@molcrafts/molvis-stage`. Dispatches on payload
 * shape (`string` → text format, `Uint8Array` → binary DCD/TRR/XTC,
 * object → mrec store), stamps the pipeline head with a `DataSource`,
 * and replays user-added modifiers. Optional `pickBondMapping` runs when
 * a dump-local overlay lacks canonical `atomi`/`atomj`.
 *
 * This is the *data* door (replace / augment / extend). STL meshes go
 * through {@link loadMeshOverlay}; directory/zip mrec stores through
 * {@link loadMrecSource}. Page drag-drop and the DataSource panel funnel
 * here via `loadFileSmart`.
 */
export async function loadFileContent(
  app: Molvis,
  content: FileContent,
  filename: string,
  format?: FileFormat,
  mode: LoadMode = "replace",
  pickBondMapping?: PickBondMapping,
): Promise<void> {
  if (typeof content === "string" || content instanceof Uint8Array) {
    const report = new LoadReport(app, filename, content.length);
    report.parsing(format);
    const bundle =
      typeof content === "string"
        ? loadTextTrajectory(content, filename, format)
        : loadBinaryTrajectory(content, filename, format);
    report.parsed();
    await commitLoadedTrajectory(
      app,
      bundle.trajectory,
      bundle.dispose,
      filename,
      mode,
      pickBondMapping,
    );
    report.done();
    return;
  }
  // mrec store record: the same ingress as every other store shape — the
  // worker decodes it when Workers exist, the sync provider otherwise.
  await loadMrecSource(
    app,
    { kind: "files", files: mrecFilesFromRecord(content) },
    filename,
    mode,
    pickBondMapping,
  );
}

/**
 * A record's `frame` section, read while the store is still readable.
 *
 * The order is load-bearing, not tidy: opening the sequence hands the store's
 * buffers to the worker in a transfer list, which **detaches them**, so
 * anything else the record carries has to be read first or not at all.
 */
async function takeMrecFrameSection(
  input: MrecStoreInput,
  wanted: boolean,
): Promise<Frame | undefined> {
  return wanted ? await readMrecFrameSection(input) : undefined;
}

/**
 * mrec store ingress — every host door for a `*.mrec` directory or a packed
 * `*.mrec.zip` funnels here. `source` is either the async list/read host
 * ({@link MrecDirectorySource}: molexp, the VS Code extension host) or one of
 * the {@link MrecStoreInput} shapes (in-memory files, browser `File` handles,
 * a zip `Blob`).
 *
 * With Workers available the trajectory worker owns the molrs
 * `MrecReader` (`openMrecTrajectory`): store bytes are posted once or
 * read lazily from `File` handles, and frames stream back as transferables
 * carrying their section update ids. Without Workers the sync main-thread
 * provider (`loadMrecInput`) opens the store here. Both land in
 * `commitLoadedTrajectory`, the pipeline's single ingress.
 */
export async function loadMrecSource(
  app: Molvis,
  source: MrecDirectorySource | MrecStoreInput,
  filename: string,
  mode: LoadMode = "replace",
  pickBondMapping?: PickBondMapping,
): Promise<void> {
  const input: MrecStoreInput = isMrecDirectorySource(source)
    ? { kind: "files", files: await collectMrecDirectory(source) }
    : source;

  // Sections are independent, and the key set already names them — so decide
  // what this record is before touching it. A run commonly writes the topology
  // once as `frame` and the coordinates over time as `trajectory`; both are
  // opened, and composition puts them back together (the frame broadcasts, the
  // sequence owns the timeline) exactly as LAMMPS data + DCD do.
  const groups = mrecStoreGroups(input);
  const known = groups.size > 0;
  const hasTrajectory = !known || groups.has("trajectory");
  // Read the frame before the sequence: opening the sequence detaches the
  // store's buffers into the worker.
  const frameSection = await takeMrecFrameSection(
    input,
    known ? groups.has("frame") : true,
  );

  if (!hasTrajectory) {
    if (!frameSection) {
      throw new Error(
        `${filename} carries no frames to show — this record holds ${[...groups].sort().join(" + ")}.`,
      );
    }
    const snapshot = new Trajectory([frameSection]);
    await commitLoadedTrajectory(
      app,
      snapshot,
      () => snapshot.dispose(),
      filename,
      mode,
      pickBondMapping,
    );
    app.events.emit("status-message", {
      text: `Loaded a snapshot from ${filename}`,
      type: "info",
    });
    return;
  }

  if (typeof Worker === "undefined") {
    const bundle = await loadMrecInput(input);
    await commitLoadedTrajectory(
      app,
      bundle.trajectory,
      bundle.dispose,
      filename,
      mode,
      pickBondMapping,
    );
    await addMrecFrameOverlay(app, frameSection, filename);
    return;
  }

  // HUD first on replace, as `loadFileStream` does — a stuck worker still
  // shows `0/0…`. Augment keeps the existing timeline.
  if (mode !== "augment") {
    app.events.emit("length-changed", {
      indexedLength: 0,
      length: null,
      indexComplete: false,
    });
  }
  const runtime = await spawnTrajectoryWorker("mrec");
  // Register before the open so destroy / a superseding load during the
  // open still terminates the worker (mirrors `loadFileStream`).
  disposeInFlightStream(app);
  streamInFlightCleanups.set(app, () => void runtime.close());
  let bundle: Awaited<ReturnType<typeof openMrecTrajectory>>;
  try {
    bundle = await openMrecTrajectory(runtime, input);
  } catch (err) {
    streamInFlightCleanups.delete(app);
    void runtime.close();
    if (frameSection) {
      // A packed store hides its keys, so its shape is only known now. It is
      // a snapshot after all.
      const snapshot = new Trajectory([frameSection]);
      await commitLoadedTrajectory(
        app,
        snapshot,
        () => snapshot.dispose(),
        filename,
        mode,
        pickBondMapping,
      );
      return;
    }
    throw err;
  }
  const { trajectory, dispose } = bundle;
  streamInFlightCleanups.set(app, dispose);
  app.events.emit("length-changed", {
    indexedLength: trajectory.indexedLength,
    length: trajectory.length,
    indexComplete: true,
  });

  streamInFlightCleanups.delete(app);
  await commitLoadedTrajectory(
    app,
    trajectory,
    dispose,
    filename,
    mode,
    pickBondMapping,
  );
  if (mode === "augment" && (trajectory.length ?? 0) <= 1) {
    // A single-frame augment lands as a MemoryDataSource holding frame 0;
    // nothing keeps navigating the worker, so release it (frames stay: the
    // data source still holds the one it copied out of the LRU).
    void runtime.close();
  }
  await addMrecFrameOverlay(app, frameSection, filename);
  app.events.emit("status-message", {
    text: `Loaded ${trajectory.indexedLength} frame(s) from ${filename}`,
    type: "info",
  });
}

/**
 * Add the record's `frame` section beside its trajectory.
 *
 * Both sections describe the same system: a run writes the topology once and
 * the coordinates every step, so the frame is a length-1 source that
 * broadcasts across the sequence. That is the composition molvis already does
 * for LAMMPS data + DCD, reached here without the user having to open two
 * files.
 */
async function addMrecFrameOverlay(
  app: Molvis,
  frame: Frame | undefined,
  filename: string,
): Promise<void> {
  if (!frame) return;
  await app.addDataSource(
    new MemoryDataSource(frame, {
      sourceType: "file",
      filename: `${filename} (frame)`,
    }),
  );
}

/**
 * @deprecated Renamed to {@link loadMrecSource} — mrec is the product, zarr the
 * encoding. Kept for one deprecation window.
 */
export const loadZarrSource = loadMrecSource;

/**
 * Mesh ingress — an STL opened as scene geometry.
 *
 * A door of its own rather than a branch of {@link loadFileContent}, because
 * the payload is not scene *data*: it has no atoms, no box and no frames, so
 * it never becomes a `DataSource` and never enters source composition. It
 * lands as a {@link MeshOverlayModifier} (plus the `Draw surface` companion
 * `addModifier` pairs with it) and then simply stays there — a static prop the
 * trajectory plays inside, unaffected by seeking, playback, or a topology file
 * arriving later.
 *
 * The load is always additive: dropping a mesh never clears the scene, so a
 * `LoadMode` would have nothing to choose between.
 *
 * Throws `StlParseError` when the bytes are not an STL; the caller surfaces
 * the message.
 */
export async function loadMeshOverlay(
  app: Molvis,
  bytes: Uint8Array,
  filename: string,
): Promise<void> {
  const mesh = parseStl(bytes);
  const overlay = new MeshOverlayModifier();
  overlay.setMesh(mesh, filename);
  app.modifierPipeline.addModifier(overlay);
  await app.applyPipeline({ fullRebuild: true });
  app.world.fit();
  app.events.emit("status-message", {
    text: `Loaded ${overlay.triangleCount} triangle(s) from ${filename}`,
    type: "info",
  });
}

export interface LoadFileStreamOptions {
  /** Indexing-progress callback. Called periodically (≤10 Hz) during
   *  the worker's blocking index pass. Useful for status-bar updates. */
  onProgress?: IndexProgressCallback;
  /** Bytes per indexer chunk. Default 8 MiB. */
  chunkSize?: number;
  /** Abort the blocking index pass. The worker drops at the next chunk. */
  signal?: AbortSignal;
  /** Sidecar cache key. Hosts that already indexed near the data pass this. */
  fingerprint?: string;
}

export interface LoadFileStreamResult {
  /** The runtime the loader spawned. Hand off to UI for cancellation /
   *  later disposal. The caller does NOT need to call `runtime.close()`
   *  manually — the next file load (or `applyEmptyTrajectory`) disposes
   *  this one automatically through the registered cleanup. */
  runtime: TrajectoryRuntime;
}

/**
 * Streaming file ingress. Used for large text-format *trajectories*
 * (LAMMPS dump / XYZ / PDB / SDF). LAMMPS data is a structure and
 * stays on the whole-file path. The original file is
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
function isTrajectorySource(
  value: Blob | TrajectorySource,
): value is TrajectorySource {
  return (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    "readRange" in value
  );
}

export async function loadFileStream(
  app: Molvis,
  file: Blob | TrajectorySource,
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
  // HUD first on replace — emit before spawning so a stuck worker still
  // shows `0/0…`. Augment keeps the existing timeline until the new
  // source reports progress (data + DCD must not flash back to 0/0).
  if (mode !== "augment") {
    app.events.emit("length-changed", {
      indexedLength: 0,
      length: null,
      indexComplete: false,
    });
  }
  // canStream narrows `format` to the worker's `Format` type, so
  // the spawn accepts it without a cast.
  const runtime = await spawnTrajectoryWorker(format);
  const source = isTrajectorySource(file) ? file : new BlobRangeSource(file);
  // Real Files have stable identity (size + lastModified) so we can
  // key the OPFS index sidecar against them. Network-fetched Blobs
  // come through `loadFileContent` (eager path) instead of this
  // streaming path, so this only fingerprints user-dropped files.
  const fingerprint =
    options.fingerprint ??
    (file instanceof File ? fingerprintFile(file, format) : undefined);

  if (options.signal?.aborted) {
    await runtime.close();
    throw new CancellationError(-1);
  }
  const onAbort = () => runtime.cancelOpen();
  options.signal?.addEventListener("abort", onAbort, { once: true });

  const provider: AsyncFrameProvider = {
    get: (index) => runtime.loadFrameLatest(index),
    dispose: () => {
      void runtime.close();
    },
  };
  const trajectory = Trajectory.fromAsyncProvider(provider);
  const streamDispose = () => {
    trajectory.dispose();
  };
  // Register before `open()` so destroy / a superseding stream load during
  // indexing still terminates the worker. Keep this separate from
  // `appCleanups` — augment/replace must not dispose the committed scene.
  disposeInFlightStream(app);
  streamInFlightCleanups.set(app, streamDispose);

  const emitLength = (): void => {
    app.events.emit("length-changed", {
      indexedLength: trajectory.indexedLength,
      length: trajectory.length,
      indexComplete: trajectory.indexComplete,
    });
  };

  let opened: Awaited<ReturnType<typeof runtime.open>>;
  try {
    opened = await runtime.open(source, {
      onProgress: (event) => {
        options.onProgress?.(event);
        if (event.framesIndexedSoFar > trajectory.indexedLength) {
          trajectory.recordIndexedLength(event.framesIndexedSoFar);
          emitLength();
        }
      },
      onIndexComplete: (result) => {
        trajectory.recordIndexedLength(result.indexedLength, result.length);
        if (!trajectory.indexComplete) trajectory.markIndexComplete();
        emitLength();
        app.events.emit("index-complete", {
          indexedLength: trajectory.indexedLength,
          length: trajectory.length,
        });
      },
      chunkSize: options.chunkSize,
      fingerprint,
    });
  } catch (err) {
    streamDispose();
    streamInFlightCleanups.delete(app);
    if (err instanceof CancellationError || options.signal?.aborted) {
      throw err instanceof CancellationError ? err : new CancellationError(-1);
    }
    throw err;
  } finally {
    options.signal?.removeEventListener("abort", onAbort);
  }

  trajectory.recordIndexedLength(
    opened.indexedLength,
    opened.length === null ? undefined : opened.length,
  );
  if (opened.indexComplete && !trajectory.indexComplete) {
    trajectory.markIndexComplete();
  }

  if (mode === "extend") {
    await runtime.whenIndexComplete;
    streamInFlightCleanups.delete(app);
    await extendIntoScene(
      app,
      trajectory,
      streamDispose,
      filename,
      pickBondMapping,
    );
    app.events.emit("status-message", {
      text: `Extended current scene with ${trajectory.indexedLength} frame(s) from ${filename}`,
      type: "info",
    });
    return { runtime };
  }

  if (mode === "augment") {
    await runtime.whenIndexComplete;
    try {
      await augmentTrajectoryAsDataSource(
        app,
        trajectory,
        { sourceType: "file", filename },
        pickBondMapping,
      );
    } catch (err) {
      streamDispose();
      streamInFlightCleanups.delete(app);
      throw err;
    }

    const augmentedFrames = trajectory.length ?? trajectory.indexedLength;
    if (augmentedFrames <= 1) {
      // MemoryDataSource owns frame 0 only — release the worker now.
      streamDispose();
      streamInFlightCleanups.delete(app);
    } else {
      // FileDataSource owns the async trajectory; pipeline.clear on destroy.
      streamInFlightCleanups.delete(app);
    }

    app.events.emit("status-message", {
      text: `Loaded ${trajectory.indexedLength} frame(s) from ${filename}`,
      type: "info",
    });
    app.world.fit();
    app.setMode("view");
    return { runtime };
  }

  app.events.emit("status-message", {
    text: opened.indexComplete
      ? `Loaded ${trajectory.indexedLength} frame(s) from ${filename}`
      : `Showing frame 1; indexing ${filename}…`,
    type: "info",
  });
  streamInFlightCleanups.delete(app);
  await installPrimaryTrajectory(
    app,
    trajectory,
    streamDispose,
    filename,
    pickBondMapping,
  );
  return { runtime };
}
