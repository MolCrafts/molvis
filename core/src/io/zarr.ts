import { type Frame, RecordReader } from "@molcrafts/molrs";
import { Trajectory } from "../system/trajectory";
import { logger } from "../utils/logger";

const FRAME_CACHE_SIZE = 16;

export interface ZarrLoadResult {
  trajectory: Trajectory;
  dispose: () => void;
}

function decodeBase64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function evictOldest(cache: Map<number, Frame>): void {
  const oldest = cache.keys().next().value as number | undefined;
  if (oldest !== undefined) {
    cache.get(oldest)?.free();
    cache.delete(oldest);
  }
}

/**
 * Load a zarr directory (supplied as a file-path → base64 map) into a
 * lazy Trajectory backed by molrs's RecordReader. The returned `dispose`
 * frees the reader and its frame cache; the io ingress calls it before
 * swapping in the next trajectory.
 */
export function loadZarrFiles(files: Record<string, string>): ZarrLoadResult {
  const fileMap = new Map<string, Uint8Array>();
  for (const [filePath, contentB64] of Object.entries(files)) {
    fileMap.set(filePath, decodeBase64ToBytes(contentB64));
  }

  const reader = new RecordReader(fileMap);
  const frameCount = reader.countFrames();
  const cache = new Map<number, Frame>();

  const provider = {
    length: frameCount,
    get(index: number): Frame {
      const cached = cache.get(index);
      if (cached) return cached;
      const frame = reader.readFrame(index);
      if (!frame) throw new Error(`Zarr frame ${index} out of range`);
      if (cache.size >= FRAME_CACHE_SIZE) evictOldest(cache);
      cache.set(index, frame);
      return frame;
    },
  };

  const trajectory = Trajectory.fromProvider(provider);

  const dispose = () => {
    for (const frame of cache.values()) frame.free();
    cache.clear();
    reader.free();
  };

  logger.info(`[zarr] Loaded ${frameCount} frame(s)`);
  return { trajectory, dispose };
}
