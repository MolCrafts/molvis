import {
  type Block,
  CifReader,
  type Frame,
  GroReader,
  Mol2Reader,
  readCubeStr,
  readVaspChgcarStr,
  VaspPoscarReader,
} from "@molcrafts/molvis-core/molrs";
import { type FrameProvider, Trajectory } from "../system/trajectory";
import {
  type MolrsTrajStream,
  makeStream,
  takeFrameOffsets,
  writeStreamInput,
} from "../transport/trajectory_worker/streams";
import { DType } from "../utils/dtype";
import { logger } from "../utils/logger";
import { normalizeFrameBox } from "./box_presence";
import {
  DUMP_LOCAL_BONDS_LABEL,
  describeFormat,
  type FileFormat,
  getAllAcceptExtensions,
  inferFormatFromFilename,
  matchBondEndpointColumns,
} from "./formats";
import { toIoError } from "./load_error";
import { normalizeAtomCoords, normalizeAtomElements } from "./normalize_coords";

export {
  canStream,
  decideIngest,
  describeFormat,
  dropLoadMode,
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
  STL_SUFFIX,
  STREAMING_FILE_THRESHOLD_BYTES,
  type StreamingCapability,
  sniffFormatFromTextHead,
  TRAJECTORY_WHOLE_FILE_CAP_BYTES,
  wholeFileTrajectoryReason,
} from "./formats";
export { extractMessage, toIoError } from "./load_error";

/** The molrs per-format reader surface (`CifReader`, `GroReader`, …). */
interface MultiFrameReader {
  len(): number;
  readFrame(index: number): Frame | undefined;
  free(): void;
}

/**
 * A whole in-memory file read through its molrs `*Stream`: molrs indexes the
 * frame boundaries once, then decodes one frame per `readFrame`. The formats
 * molrs reads as streams have no per-format reader class.
 */
class StreamFrameReader implements MultiFrameReader {
  private readonly offsets: Array<{ byteOffset: number; byteLen: number }>;
  private readonly parser: MolrsTrajStream;

  constructor(
    private readonly bytes: Uint8Array,
    makeParser: () => MolrsTrajStream,
  ) {
    const indexer = makeParser();
    try {
      indexer.hintTotalBytes(bytes.byteLength);
      writeStreamInput(indexer, bytes);
      this.offsets = [
        ...takeFrameOffsets(indexer.feedIndexChunk(0, bytes.byteLength)),
        ...takeFrameOffsets(indexer.finishIndex()),
      ];
      this.parser = makeParser();
      // DCD decodes against the header the indexer saw; text formats and
      // XTC / TRR report an empty state.
      const decoderState = indexer.decoderState();
      if (decoderState && decoderState.length > 0) {
        this.parser.setDecoderState(decoderState);
      }
    } finally {
      indexer.free();
    }
  }

  len(): number {
    return this.offsets.length;
  }

  readFrame(index: number): Frame | undefined {
    const pos = this.offsets[index];
    if (!pos) return undefined;
    writeStreamInput(
      this.parser,
      this.bytes.subarray(pos.byteOffset, pos.byteOffset + pos.byteLen),
    );
    return this.parser.parseRangeInInput(0, pos.byteLen);
  }

  free(): void {
    this.parser.free();
  }
}

/** A single-frame file already read into its one `Frame`. */
class SingleFrameReader implements MultiFrameReader {
  constructor(private frame: Frame | null) {}

  len(): number {
    return 1;
  }

  /** Hands the frame over once; the trajectory cache owns it from then on. */
  readFrame(index: number): Frame | undefined {
    if (index !== 0 || !this.frame) return undefined;
    const frame = this.frame;
    this.frame = null;
    return frame;
  }

  free(): void {
    this.frame?.free();
    this.frame = null;
  }
}

const FRAME_CACHE_SIZE = 16;

export interface ReaderLoadResult {
  trajectory: Trajectory;
  dispose: () => void;
}

function formatLabel(format: FileFormat): string {
  try {
    return describeFormat(format).label;
  } catch {
    return format;
  }
}

/**
 * Call a molrs reader method and rethrow with format context.
 * molrs throws **raw strings** on parse failure — never drop them.
 */
function callReader<T>(format: FileFormat, op: string, fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    throw toIoError(e, `${formatLabel(format)} (${format}) ${op}`);
  }
}

function openTextReader(content: string, format: FileFormat): MultiFrameReader {
  return callReader(format, "open", () => {
    switch (format) {
      case "pdb":
      case "xyz":
      case "lammps":
      case "lammps-dump":
      case "sdf":
        return new StreamFrameReader(new TextEncoder().encode(content), () =>
          makeStream(format),
        );
      case "cif":
        return new CifReader(content);
      case "gro":
        return new GroReader(content);
      case "mol2":
        return new Mol2Reader(content);
      case "poscar":
        return new VaspPoscarReader(content);
      case "cube":
        return new SingleFrameReader(readCubeStr(content));
      case "chgcar":
        return new SingleFrameReader(readVaspChgcarStr(content));
      default:
        // Unreachable in practice: loadTextTrajectory rejects
        // payload="binary" formats before reaching this dispatch. Kept
        // explicit so adding a new text format and forgetting to wire its
        // WASM reader fails loudly rather than mis-parsing or returning
        // undefined.
        throw new Error(
          `Format "${format}" declares payload="text" but has no WASM reader wired up in openTextReader.`,
        );
    }
  });
}

function openBinaryReader(
  bytes: Uint8Array,
  format: FileFormat,
): MultiFrameReader {
  return callReader(format, "open", () => {
    switch (format) {
      case "dcd":
      case "trr":
      case "xtc":
        return new StreamFrameReader(bytes, () => makeStream(format));
      default:
        // Unreachable in practice: loadBinaryTrajectory rejects non-binary
        // formats via descriptor.payload before reaching this dispatch.
        // Kept as an explicit guard so adding a new binary format and
        // forgetting to wire its WASM reader fails loudly rather than
        // silently mis-parsing.
        throw new Error(
          `Format "${format}" declares payload="binary" but has no WASM reader wired up in openBinaryReader.`,
        );
    }
  });
}

function evictOldest(cache: Map<number, Frame>): void {
  const oldest = cache.keys().next().value as number | undefined;
  if (oldest === undefined) return;
  cache.get(oldest)?.free();
  cache.delete(oldest);
}

/**
 * A LAMMPS `dump local` file parses into an `entries` block — molrs names it
 * that deliberately, because `dump local` carries arbitrary per-local-value
 * rows (bonds, angles, pair distances) under column names the *user* chose.
 * This promotes the ones that are bonds to a `bonds` block, which is what
 * puts them in front of the bond-column mapping and the bond renderer.
 *
 * Two independent signals say "these rows are bonds", and either is enough:
 *
 * 1. **The section label.** `dump_modify … label BONDS` is what OVITO's
 *    manual tells users to set, and molrs records it as `dump_local_label`.
 *    This is the only signal that survives the default column naming — a
 *    plain `dump local c_bond[1] c_bond[2]` header means nothing on its own —
 *    so without it such a file would sit in `entries` forever: no bonds
 *    block, hence no mapping prompt, hence a drop that appears to do nothing.
 * 2. **Recognisable endpoint columns** ({@link matchBondEndpointColumns}),
 *    which is how a default-labelled (`ENTRIES`) file whose columns were
 *    named with `dump_modify … colname` still gets recognised.
 *
 * The promoted block does NOT yet satisfy molvis's bonds contract — its
 * endpoints are LAMMPS atom ids under the file's own column names, not
 * `atomi`/`atomj` row indices. `BondColumnRemapModifier` is what completes
 * it, from an inferred or user-supplied mapping.
 */
function normalizeDumpLocalEntries(frame: Frame): void {
  const entries = frame.has("entries") ? frame.get("entries") : undefined;
  if (entries === undefined || entries.nRows === 0) return;
  if (frame.has("bonds")) return;
  const labelledBonds =
    frame.getMeta("dump_local_label") === DUMP_LOCAL_BONDS_LABEL;
  const namedEndpoints = matchBondEndpointColumns(entries.keys()) !== undefined;
  // Default `dump local c_bond[1] c_bond[2]` is labelled ENTRIES and the
  // columns mean nothing — still promote so the mapping picker can ask,
  // rather than leaving topology in `entries` with no prompt.
  const numericEndpoints =
    !frame.has("atoms") && numericColumnCount(entries) >= 2;
  if (!labelledBonds && !namedEndpoints && !numericEndpoints) return;
  frame.renameBlock("entries", "bonds");
}

function numericColumnCount(block: Block): number {
  let n = 0;
  for (const key of block.keys()) {
    const dt = block.dtype(key);
    if (
      dt === DType.Int ||
      dt === DType.U32 ||
      dt === DType.Float ||
      dt === DType.Uint
    ) {
      n += 1;
    }
  }
  return n;
}

function resolveFormat(filename: string, format?: FileFormat): FileFormat {
  const resolved = format ?? inferFormatFromFilename(filename);
  if (!resolved) {
    throw new Error(
      `Unable to detect format from filename "${filename}". ` +
        `Supported extensions: ${getAllAcceptExtensions()}.`,
    );
  }
  return resolved;
}

/**
 * Wrap a `MultiFrameReader` (returned by either `openTextReader` or
 * `openBinaryReader`) into a {@link Trajectory} backed by an
 * LRU-cached lazy frame provider. The reader is kept alive for the
 * lifetime of the trajectory and freed by `dispose()`.
 *
 * Format-agnostic: anything that satisfies `MultiFrameReader` flows
 * through this single packager.
 */
function buildLazyTrajectory(
  reader: MultiFrameReader,
  format: FileFormat,
): ReaderLoadResult {
  const label = formatLabel(format);
  let frameCount: number;
  try {
    frameCount = callReader(format, "index", () => reader.len());
  } catch (e) {
    try {
      reader.free();
    } catch {
      /* ignore free errors after a failed index */
    }
    throw e;
  }

  if (frameCount === 0) {
    try {
      reader.free();
    } catch {
      /* ignore */
    }
    const hints: Record<string, string> = {
      lammps:
        "Expected a LAMMPS data file (header with `N atoms` / `Atoms` section). If this is a dump trajectory, pick “LAMMPS Dump / Trajectory” instead.",
      "lammps-dump":
        "Expected frames starting with `ITEM: TIMESTEP`. If this is a data file, pick “LAMMPS Data” instead.",
    };
    const hint = hints[format] ? ` ${hints[format]}` : "";
    throw new Error(
      `${label} (${format}): parser found 0 frames — content is not valid for this format.${hint}`,
    );
  }

  const cache = new Map<number, Frame>();
  const provider: FrameProvider = {
    length: frameCount,
    get(index: number): Frame {
      if (index < 0 || index >= frameCount) {
        throw new Error(
          `${label}: frame index ${index} out of range [0, ${frameCount})`,
        );
      }

      const cached = cache.get(index);
      if (cached) return cached;

      const frame = callReader(format, `read frame ${index}`, () =>
        reader.readFrame(index),
      );
      if (!frame) {
        throw new Error(
          `${label} (${format}): reader returned no frame at step ${index}`,
        );
      }
      try {
        // LAMMPS dumps often emit xu/yu/zu or xs/ys/zs — LinkedCell/RDF only
        // read canonical x/y/z. Alias before any analysis or render path.
        normalizeAtomCoords(frame);
        normalizeAtomElements(frame);
        // Zero-size cells → no box (Simulation cell does not auto-attach).
        normalizeFrameBox(frame);
        // Bond-only `dump local` overlays carry their topology in `entries`.
        normalizeDumpLocalEntries(frame);
      } catch (e) {
        throw toIoError(e, `${label} (${format}) normalize frame ${index}`);
      }

      // molrs data/dump readers can return a "success" empty frame when the
      // content does not match the chosen format. Fail loud with format context
      // instead of letting the pipeline die later as "Failed to load <name>".
      if (formatRequiresAtoms(format)) {
        const atoms = frame.has("atoms") ? frame.get("atoms") : undefined;
        const n = atoms?.nRows ?? 0;
        // A `dump local` bond overlay has no atoms block at all — it is the
        // topology supplement dropped onto an existing trajectory, so only
        // fail an empty-atom frame when there is no `bonds` block either.
        const bondOnlyOverlay =
          format === "lammps-dump" &&
          (frame.has("bonds") ? frame.get("bonds").nRows : 0) > 0;
        if (n === 0 && !bondOnlyOverlay) {
          const hints: Partial<Record<FileFormat, string>> = {
            lammps:
              "No Atoms section parsed. Confirm this is a LAMMPS data file; for dump trajectories choose “LAMMPS Dump / Trajectory”.",
            "lammps-dump":
              "No atoms in this dump frame. Confirm `ITEM: ATOMS` columns include coordinates, or try “LAMMPS Data” if this is a data file.",
          };
          const hint = hints[format] ? ` ${hints[format]}` : "";
          throw new Error(
            `${label} (${format}): frame ${index} has 0 atoms — content is not valid for this format.${hint}`,
          );
        }
      }

      if (cache.size >= FRAME_CACHE_SIZE) evictOldest(cache);
      cache.set(index, frame);
      return frame;
    },
  };

  function formatRequiresAtoms(format: FileFormat): boolean {
    switch (format) {
      case "cube":
      case "chgcar":
      case "dcd":
      case "trr":
      case "xtc":
        // Volumetric / pure-trajectory formats may ship without a rebuilt
        // atoms block at open time (topology comes from a paired structure).
        return false;
      default:
        return true;
    }
  }

  const trajectory = Trajectory.fromProvider(provider);
  // Teardown-only free. `evictOldest` above refuses to free a mid-life frame
  // (it races `_lastRenderedFrame` / SceneIndex); this closure frees the whole
  // cache and must run only AFTER the scene has been swapped off these frames.
  // `installPrimaryTrajectory` (io/index.ts) defers the outgoing file's cleanup
  // until `replaceScene` has moved `_lastRenderedFrame` onto the incoming
  // trajectory, so no render can deref a freed handle here. See
  // `.claude/notes/molrs-handles.md`.
  const dispose = () => {
    for (const frame of cache.values()) {
      frame.free();
    }
    cache.clear();
    reader.free();
  };

  logger.debug(
    `[reader] opened lazy ${format} reader with ${frameCount} frame(s)`,
  );
  return { trajectory, dispose };
}

/**
 * Open a text-format trajectory lazily.
 *
 * The returned Trajectory keeps the WASM reader alive and reads frames on
 * demand through a small LRU cache, rather than materializing `Frame[]`
 * upfront.
 *
 * Throws if the resolved format declares `payload: "binary"` — callers
 * that have raw bytes must use {@link loadBinaryTrajectory} instead.
 */
export function loadTextTrajectory(
  content: string,
  filename: string,
  format?: FileFormat,
): ReaderLoadResult {
  const resolved = resolveFormat(filename, format);
  const desc = describeFormat(resolved);
  if (desc.payload !== "text") {
    throw new Error(
      `Format "${resolved}" is binary; pass a Uint8Array to loadBinaryTrajectory instead of a string to loadTextTrajectory.`,
    );
  }
  return buildLazyTrajectory(openTextReader(content, resolved), resolved);
}

/**
 * Open a binary-format trajectory lazily.
 *
 * Mirror of {@link loadTextTrajectory} for formats whose descriptor
 * declares `payload: "binary"`. The eager dispatch in
 * {@link loadFileContent} routes `Uint8Array` payloads here once a
 * binary reader has been registered (DCD is the first such format).
 *
 * Throws if no format with `payload: "binary"` is registered yet, or
 * if the caller passed a binary buffer for a text format.
 */
export function loadBinaryTrajectory(
  bytes: Uint8Array,
  filename: string,
  format?: FileFormat,
): ReaderLoadResult {
  const resolved = resolveFormat(filename, format);
  const desc = describeFormat(resolved);
  if (desc.payload !== "binary") {
    throw new Error(
      `Format "${resolved}" is text; pass a string to loadTextTrajectory instead of a Uint8Array to loadBinaryTrajectory.`,
    );
  }
  return buildLazyTrajectory(openBinaryReader(bytes, resolved), resolved);
}

/**
 * Eager helper that materializes every frame from `content`.
 *
 * The canonical app ingress uses `loadTextTrajectory()` instead so the
 * Trajectory can keep the reader alive and fetch frames lazily.
 *
 * If `format` is omitted, the extension is used to dispatch. When the
 * extension is unrecognized and no `format` is supplied we throw, since
 * we would otherwise be picking a parser at random. Every UI-level
 * ingress point should catch that case and prompt the user.
 *
 * Column names, dtypes, and `box` come straight from molrs. Coordinate
 * columns are preserved as-read; downstream code may prefer `x/y/z` and fall
 * back to `xu/yu/zu`, but this loader does not synthesize missing columns.
 *
 * Format-specific frame decoration (PDB backbone ribbon, VASP volumetric
 * fields, …) is no longer a side-effect of the loader. It is handled by
 * auto-attaching pipeline modifiers — see
 * `stage/src/pipeline/auto_modifiers/`.
 */
export function readFrames(
  content: string,
  filename: string,
  format?: FileFormat,
): Frame[] {
  const resolved = resolveFormat(filename, format);
  const desc = describeFormat(resolved);
  if (desc.payload !== "text") {
    throw new Error(
      `readFrames only supports text formats; "${resolved}" is binary.`,
    );
  }
  const reader = openTextReader(content, resolved);
  const frames: Frame[] = [];
  try {
    const count = reader.len();
    for (let step = 0; step < count; step++) {
      const frame = reader.readFrame(step);
      if (!frame) {
        throw new Error(`${resolved} reader returned no frame at step ${step}`);
      }
      normalizeAtomCoords(frame);
      normalizeAtomElements(frame);
      normalizeFrameBox(frame);
      normalizeDumpLocalEntries(frame);
      frames.push(frame);
    }
  } finally {
    reader.free();
  }
  logger.info(`[reader] Read ${frames.length} ${resolved} frame(s)`);
  return frames;
}
