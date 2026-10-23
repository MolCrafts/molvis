import {
  CifReader,
  DcdStream,
  type Frame,
  GroReader,
  LammpsDataStream,
  LammpsDumpStream,
  Mol2Reader,
  PdbStream,
  readCubeStr,
  readVaspChgcarStr,
  SdfStream,
  TrrStream,
  VaspPoscarReader,
  wasmMemory,
  XtcStream,
  XyzStream,
} from "@molcrafts/molvis-core/molrs";
import { type FrameProvider, Trajectory } from "../system/trajectory";
import { DType, isDomainUintDtype, isFloatColumn } from "../utils/dtype";
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

interface MultiFrameReader {
  len(): number;
  read(step: number): Frame | undefined;
  free(): void;
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

/**
 * ASE extended XYZ omits a trailing column when its value is empty
 * (`site` on atoms that have no site label). molrs counts tokens against
 * `Properties=` and rejects the short line. A quoted empty field is a
 * token, so the missing tail can be written back without shifting `pos`.
 * Plain XYZ (no `Properties=`) is returned unchanged.
 */
function padOmittedExtxyzFields(content: string): string {
  if (!content.includes("Properties=")) return content;
  const newline = content.includes("\r\n") ? "\r\n" : "\n";
  const lines = content.split(/\r?\n/);
  let changed = false;
  let index = 0;
  while (index < lines.length) {
    const countText = lines[index].trim();
    if (!/^\d+$/.test(countText)) {
      index += 1;
      continue;
    }
    const atomCount = Number(countText);
    const commentIndex = index + 1;
    if (commentIndex >= lines.length) break;
    const expected = extxyzTokenCount(lines[commentIndex]);
    index = commentIndex + 1;
    const end = Math.min(lines.length, index + atomCount);
    if (expected !== undefined) {
      for (; index < end; index += 1) {
        const trimmed = lines[index].trim();
        if (!trimmed) continue;
        const have = trimmed.split(/\s+/).length;
        if (have >= expected) continue;
        lines[index] =
          `${lines[index].trimEnd()}${' ""'.repeat(expected - have)}`;
        changed = true;
      }
    }
    index = end;
  }
  return changed ? lines.join(newline) : content;
}

/** Column count declared by an extended-XYZ `Properties=` spec, if any. */
function extxyzTokenCount(comment: string): number | undefined {
  const match = /(?:^|\s)Properties=(?:"([^"]*)"|'([^']*)'|(\S+))/.exec(
    comment,
  );
  const spec = match?.[1] ?? match?.[2] ?? match?.[3];
  if (!spec) return undefined;
  const parts = spec.split(":");
  if (parts.length < 3 || parts.length % 3 !== 0) return undefined;
  let count = 0;
  for (let i = 2; i < parts.length; i += 3) {
    const width = Number(parts[i]);
    if (!Number.isInteger(width) || width < 0) return undefined;
    count += width;
  }
  return count;
}

/** molrs keeps the quote characters on a padded `""` token. */
function unquoteEmptyExtxyzTokens(frame: Frame): void {
  const atoms = frame.has("atoms") ? frame.get("atoms") : undefined;
  if (!atoms) return;
  for (const key of atoms.keys() as string[]) {
    if (atoms.dtype(key) !== DType.String) continue;
    const values = atoms.copy(key) as string[];
    if (!values.some((value) => value === '""')) continue;
    atoms.set(
      key,
      values.map((value) => (value === '""' ? "" : value)),
    );
  }
}

interface IndexedClassReader {
  len(): number;
  readFrame(index: number): Frame | undefined;
  free(): void;
}

interface ByteIndexer {
  allocInputBuffer(len: number): number;
  feedIndexChunk(
    globalOffset: number,
    len: number,
  ): Array<{ byteOffset: number; byteLen: number; free(): void }>;
  finishIndex(): Array<{ byteOffset: number; byteLen: number; free(): void }>;
  parseRangeInInput(offset: number, len: number): Frame;
  hintTotalBytes?(total: number): void;
  free?(): void;
}

const TEXT_STREAMS: Partial<Record<FileFormat, new () => ByteIndexer>> = {
  pdb: PdbStream,
  xyz: XyzStream,
  lammps: LammpsDataStream,
  "lammps-dump": LammpsDumpStream,
  sdf: SdfStream,
};

const BINARY_STREAMS: Partial<Record<FileFormat, new () => ByteIndexer>> = {
  dcd: DcdStream,
  trr: TrrStream,
  xtc: XtcStream,
};

function classReader(reader: IndexedClassReader): MultiFrameReader {
  return {
    len: () => reader.len(),
    read: (step) => reader.readFrame(step),
    free: () => reader.free(),
  };
}

/** One frame from a whole-text door (`readCubeStr`, `readVaspChgcarStr`). */
function textOnce(
  text: string,
  parse: (text: string) => Frame,
): MultiFrameReader {
  return {
    len: () => 1,
    read: (step) => (step === 0 ? parse(text) : undefined),
    free: () => {},
  };
}

/**
 * Index a whole buffer with a molrs stream, then decode each entry from that
 * same buffer. These formats no longer have a `len`/`read` class reader.
 */
function bytesReader(
  Ctor: new () => ByteIndexer,
  bytes: Uint8Array,
): MultiFrameReader {
  const stream = new Ctor();
  stream.hintTotalBytes?.(bytes.byteLength);
  const ptr = stream.allocInputBuffer(bytes.byteLength);
  new Uint8Array(wasmMemory().buffer, ptr, bytes.byteLength).set(bytes);
  const owned = [
    ...(stream.feedIndexChunk(0, bytes.byteLength) ?? []),
    ...(stream.finishIndex() ?? []),
  ];
  const entries = owned.map((entry) => ({
    byteOffset: entry.byteOffset,
    byteLen: entry.byteLen,
  }));
  for (const entry of owned) entry.free();
  return {
    len: () => entries.length,
    read: (step) => {
      const entry = entries[step];
      if (!entry) return undefined;
      return stream.parseRangeInInput(entry.byteOffset, entry.byteLen);
    },
    free: () => stream.free?.(),
  };
}

function openTextReader(content: string, format: FileFormat): MultiFrameReader {
  return callReader(format, "open", () => {
    const Stream = TEXT_STREAMS[format];
    if (Stream) {
      const text = format === "xyz" ? padOmittedExtxyzFields(content) : content;
      return bytesReader(Stream, new TextEncoder().encode(text));
    }
    switch (format) {
      case "cif":
        return classReader(new CifReader(content));
      case "gro":
        return classReader(new GroReader(content));
      case "mol2":
        return classReader(new Mol2Reader(content));
      case "poscar":
        return classReader(new VaspPoscarReader(content));
      case "cube":
        return textOnce(content, readCubeStr);
      case "chgcar":
        return textOnce(content, readVaspChgcarStr);
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
    const Stream = BINARY_STREAMS[format];
    if (Stream) return bytesReader(Stream, bytes);
    switch (format) {
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
  const namedEndpoints =
    matchBondEndpointColumns(entries.keys() as string[]) !== undefined;
  // Default `dump local c_bond[1] c_bond[2]` is labelled ENTRIES and the
  // columns mean nothing — still promote so the mapping picker can ask,
  // rather than leaving topology in `entries` with no prompt.
  const numericEndpoints =
    !frame.has("atoms") && numericColumnCount(entries) >= 2;
  if (!labelledBonds && !namedEndpoints && !numericEndpoints) return;
  frame.renameBlock("entries", "bonds");
}

function numericColumnCount(
  block: import("@molcrafts/molvis-core/molrs").Block,
): number {
  let n = 0;
  for (const key of block.keys()) {
    const dt = block.dtype(key);
    if (
      dt === DType.I32 ||
      dt === DType.U32 ||
      isFloatColumn(dt) ||
      isDomainUintDtype(dt)
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
        reader.read(index),
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
        if (format === "xyz") unquoteEmptyExtxyzTokens(frame);
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
      const frame = reader.read(step);
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
