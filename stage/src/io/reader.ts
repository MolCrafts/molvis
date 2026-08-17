import {
  CHGCARReader,
  CIFReader,
  CubeReader,
  DCDReader,
  type Frame,
  GROReader,
  LAMMPSReader,
  LAMMPSTrajReader,
  MOL2Reader,
  PDBReader,
  POSCARReader,
  SDFReader,
  TRRReader,
  XTCReader,
  XYZReader,
} from "@molcrafts/molvis-core/molrs";
import { type FrameProvider, Trajectory } from "../system/trajectory";
import { logger } from "../utils/logger";
import { normalizeFrameBox } from "./box_presence";
import {
  describeFormat,
  type FileFormat,
  getAllAcceptExtensions,
  inferFormatFromFilename,
} from "./formats";
import { toIoError } from "./load_error";
import { normalizeAtomCoords, normalizeAtomElements } from "./normalize_coords";

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
  type StreamingCapability,
  sniffFormatFromTextHead,
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

function openTextReader(content: string, format: FileFormat): MultiFrameReader {
  return callReader(format, "open", () => {
    switch (format) {
      case "pdb":
        return new PDBReader(content);
      case "xyz":
        return new XYZReader(content);
      case "cif":
        return new CIFReader(content);
      case "lammps":
        return new LAMMPSReader(content);
      case "lammps-dump":
        return new LAMMPSTrajReader(content);
      case "sdf":
        return new SDFReader(content);
      case "cube":
        return new CubeReader(content);
      case "chgcar":
        return new CHGCARReader(content);
      case "gro":
        return new GROReader(content);
      case "mol2":
        return new MOL2Reader(content);
      case "poscar":
        return new POSCARReader(content);
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
        return new DCDReader(bytes);
      case "trr":
        return new TRRReader(bytes);
      case "xtc":
        return new XTCReader(bytes);
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
        // Zero-size cells → no box (Simulation cell does not auto-attach).
        normalizeFrameBox(frame);
      } catch (e) {
        throw toIoError(e, `${label} (${format}) normalize frame ${index}`);
      }

      // molrs data/dump readers can return a "success" empty frame when the
      // content does not match the chosen format. Fail loud with format context
      // instead of letting the pipeline die later as "Failed to load <name>".
      if (formatRequiresAtoms(format)) {
        const atoms = frame.getBlock("atoms");
        const n = atoms?.nrows() ?? 0;
        if (n === 0) {
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
  const dispose = () => {
    for (const frame of cache.values()) {
      frame.free();
    }
    cache.clear();
    reader.free();
  };

  logger.info(
    `[reader] Opened lazy ${format} trajectory with ${frameCount} frame(s)`,
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
      frames.push(frame);
    }
  } finally {
    reader.free();
  }
  logger.info(`[reader] Read ${frames.length} ${resolved} frame(s)`);
  return frames;
}
