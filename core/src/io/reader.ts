import {
  type Frame,
  LAMMPSReader,
  LAMMPSTrajReader,
  PDBReader,
  SDFReader,
  XYZReader,
} from "@molcrafts/molrs";
import { type FrameProvider, Trajectory } from "../system/trajectory";
import { logger } from "../utils/logger";
import {
  type FileFormat,
  getAllAcceptExtensions,
  inferFormatFromFilename,
} from "./formats";

export {
  describeFormat,
  type FileFormat,
  type FileFormatDescriptor,
  FILE_FORMAT_REGISTRY,
  getAllAcceptExtensions,
  inferFormatFromFilename,
} from "./formats";

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

function openReader(content: string, format: FileFormat): MultiFrameReader {
  switch (format) {
    case "pdb":
      return new PDBReader(content);
    case "xyz":
      return new XYZReader(content);
    case "lammps":
      return new LAMMPSReader(content);
    case "lammps-dump":
      return new LAMMPSTrajReader(content);
    case "sdf":
      return new SDFReader(content);
  }
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
 * Open a text-format trajectory lazily.
 *
 * The returned Trajectory keeps the WASM reader alive and reads frames on
 * demand through a small LRU cache, rather than materializing `Frame[]`
 * upfront.
 */
export function loadTextTrajectory(
  content: string,
  filename: string,
  format?: FileFormat,
): ReaderLoadResult {
  const resolved = resolveFormat(filename, format);
  const reader = openReader(content, resolved);
  const frameCount = reader.len();

  if (frameCount === 0) {
    reader.free();
    throw new Error(`${resolved} reader returned no frames`);
  }

  const cache = new Map<number, Frame>();
  const provider: FrameProvider = {
    length: frameCount,
    get(index: number): Frame {
      if (index < 0 || index >= frameCount) {
        throw new Error(`Frame index ${index} out of range [0, ${frameCount})`);
      }

      const cached = cache.get(index);
      if (cached) return cached;

      const frame = reader.read(index);
      if (!frame) {
        throw new Error(
          `${resolved} reader returned no frame at step ${index}`,
        );
      }

      if (cache.size >= FRAME_CACHE_SIZE) evictOldest(cache);
      cache.set(index, frame);
      return frame;
    },
  };

  const trajectory = Trajectory.fromProvider(provider);
  const dispose = () => {
    for (const frame of cache.values()) {
      frame.free();
    }
    cache.clear();
    reader.free();
  };

  logger.info(
    `[reader] Opened lazy ${resolved} trajectory with ${frameCount} frame(s)`,
  );
  return { trajectory, dispose };
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
 * Column names, dtypes, and `simbox` come straight from molrs. Coordinate
 * columns are preserved as-read; downstream code may prefer `x/y/z` and fall
 * back to `xu/yu/zu`, but this loader does not synthesize missing columns.
 *
 * Format-specific frame decoration (PDB backbone ribbon, VASP volumetric
 * fields, …) is no longer a side-effect of the loader. It is handled by
 * auto-attaching pipeline modifiers — see
 * `core/src/pipeline/auto_modifiers/`.
 */
export function readFrames(
  content: string,
  filename: string,
  format?: FileFormat,
): Frame[] {
  const resolved = resolveFormat(filename, format);
  const reader = openReader(content, resolved);
  const frames: Frame[] = [];
  try {
    const count = reader.len();
    for (let step = 0; step < count; step++) {
      const frame = reader.read(step);
      if (!frame) {
        throw new Error(`${resolved} reader returned no frame at step ${step}`);
      }
      frames.push(frame);
    }
  } finally {
    reader.free();
  }
  logger.info(`[reader] Read ${frames.length} ${resolved} frame(s)`);
  return frames;
}
