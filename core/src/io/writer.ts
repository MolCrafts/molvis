import {
  type Frame,
  writeFrame as wasmWriteFrame,
  writeFrameBytes as wasmWriteFrameBytes,
} from "@molcrafts/molrs";
import type { SceneIndex } from "../scene_index";
import { buildFrameFromScene } from "../scene_sync";
import { logger } from "../utils/logger";
import {
  describeFormat,
  FILE_FORMAT_REGISTRY,
  type FileFormat,
  inferFormatFromFilename,
} from "./formats";

/**
 * Formats molvis can export — exactly the registry entries whose `writable`
 * flag is set, i.e. every format molrs (via WASM) has a writer for. Text
 * formats serialize to a string; binary trajectory formats (DCD/TRR/XTC)
 * serialize to a `Uint8Array`.
 */
export type ExportFormat = FileFormat;

export interface WriteFrameOptions {
  format?: string;
  filename?: string;
}

export interface ExportPayload {
  /** String for text formats, raw bytes for binary formats (DCD/TRR/XTC). */
  content: string | Uint8Array;
  mime: string;
  suggestedName: string;
}

/** The formats with a molrs writer, in registry order. */
export function writableFormats(): FileFormat[] {
  return FILE_FORMAT_REGISTRY.filter((d) => d.writable).map((d) => d.format);
}

/** Whether `format` can be exported (molrs has a writer for it). */
export function isWritableFormat(format: string): format is FileFormat {
  return FILE_FORMAT_REGISTRY.some((d) => d.format === format && d.writable);
}

/**
 * Build an export payload from the current staged scene state without
 * mutating save-state flags.
 */
export function exportFrame(
  sceneIndex: SceneIndex,
  options: WriteFrameOptions,
): ExportPayload {
  const frame = buildFrameFromScene(sceneIndex, { markSaved: false });
  return writeFrame(frame, options);
}

/** Preferred filename extension for a format (its first registry extension). */
export function defaultExtensionForFormat(format: string): string {
  return (
    FILE_FORMAT_REGISTRY.find((d) => d.format === format)?.extensions[0] ??
    "txt"
  );
}

const MIME_BY_FORMAT: Partial<Record<FileFormat, string>> = {
  pdb: "chemical/x-pdb",
  xyz: "chemical/x-xyz",
  cif: "chemical/x-cif",
  mol2: "chemical/x-mol2",
  gro: "chemical/x-gro",
};

/** Download MIME type for a serialized format. */
export function mimeForFormat(format: string): string {
  const desc = FILE_FORMAT_REGISTRY.find((d) => d.format === format);
  if (desc?.payload === "binary") return "application/octet-stream";
  return MIME_BY_FORMAT[format as FileFormat] ?? "text/plain";
}

/**
 * Serialize a frame in the requested format via the molrs WASM writer.
 *
 * Text formats (PDB/XYZ/CIF/Cube/GRO/mol2/POSCAR/LAMMPS) return a string;
 * binary trajectory formats (DCD/TRR/XTC) return a `Uint8Array`. The format
 * is taken from `options.format`, else inferred from `options.filename`, else
 * defaults to PDB. Throws when the resolved format has no molrs writer (e.g.
 * SDF, CHGCAR) — those are read-only.
 */
export function writeFrame(
  frame: Frame,
  options: WriteFrameOptions,
): ExportPayload {
  let filename = options.filename || "structure";
  let format = options.format;
  if (!format && filename) {
    format = inferFormatFromFilename(filename) ?? undefined;
  }
  if (!format) format = "pdb";

  if (!isWritableFormat(format)) {
    throw new Error(
      `Format "${format}" is not writable — molrs has no writer for it. ` +
        `Writable formats: ${writableFormats().join(", ")}.`,
    );
  }

  const desc = describeFormat(format);
  let content: string | Uint8Array;
  try {
    content =
      desc.payload === "binary"
        ? wasmWriteFrameBytes(frame, format)
        : wasmWriteFrame(frame, format);
  } catch (e) {
    logger.error(`[writer] Error writing ${format} frame via WASM:`, e);
    throw e;
  }

  const ext = defaultExtensionForFormat(format);
  if (!filename.toLowerCase().endsWith(`.${ext}`)) {
    filename = `${filename}.${ext}`;
  }

  const size =
    typeof content === "string" ? content.length : content.byteLength;
  logger.info(`[writer] Wrote ${format} frame (${size} bytes)`);

  return { content, mime: mimeForFormat(format), suggestedName: filename };
}

/** Convenience: serialize a frame as a PDB string. */
export function writePDBFrame(frame: Frame): string {
  return wasmWriteFrame(frame, "pdb");
}

/** Convenience: serialize a frame as an XYZ string. */
export function writeXYZFrame(frame: Frame): string {
  return wasmWriteFrame(frame, "xyz");
}

/** Convenience: serialize a frame as a LAMMPS data string. */
export function writeLAMMPSData(frame: Frame): string {
  return wasmWriteFrame(frame, "lammps");
}
