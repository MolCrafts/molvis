/**
 * File-format registry and extension inference.
 *
 * This module intentionally has **no dependencies** on the rest of core
 * (no BabylonJS, no WASM, no logger) so that host-side tooling — such as
 * the VS Code extension's activation bundle — can import the registry and
 * run `inferFormatFromFilename` / `getAllAcceptExtensions` without
 * dragging in the rendering engine. The parser dispatch itself lives in
 * `reader.ts`, which imports from here.
 */

export type FileFormat = "pdb" | "xyz" | "lammps" | "lammps-dump" | "sdf";

export interface FileFormatDescriptor {
  readonly format: FileFormat;
  readonly label: string;
  readonly description: string;
  readonly extensions: readonly string[];
}

export const FILE_FORMAT_REGISTRY: readonly FileFormatDescriptor[] = [
  {
    format: "pdb",
    label: "Protein Data Bank",
    description: "RCSB PDB-style ATOM/HETATM records (.pdb, .ent, .brk)",
    extensions: ["pdb", "ent", "brk"],
  },
  {
    format: "xyz",
    label: "XYZ / Extended XYZ",
    description:
      "Cartesian coordinates, optional properties header (.xyz, .extxyz, .exyz)",
    extensions: ["xyz", "extxyz", "exyz"],
  },
  {
    format: "lammps",
    label: "LAMMPS Data",
    description:
      "LAMMPS data / restart-text file (.data, .lmp, .lammps, .lammpsdata)",
    extensions: ["data", "lmp", "lammps", "lammpsdata"],
  },
  {
    format: "lammps-dump",
    label: "LAMMPS Dump / Trajectory",
    description:
      "LAMMPS dump trajectory (.dump, .lammpstrj, .lmptrj, .lammpsdump)",
    extensions: ["dump", "lammpstrj", "lmptrj", "lammpsdump"],
  },
  {
    format: "sdf",
    label: "MDL Molfile / SDF",
    description:
      "MDL V2000 connection table; multi-record SDF exposes each record as a frame (.sdf, .mol)",
    extensions: ["sdf", "mol"],
  },
];

/** Returns the descriptor for a canonical FileFormat. */
export function describeFormat(format: FileFormat): FileFormatDescriptor {
  const descriptor = FILE_FORMAT_REGISTRY.find((d) => d.format === format);
  if (!descriptor) {
    throw new Error(`No descriptor registered for format "${format}"`);
  }
  return descriptor;
}

/**
 * Flat list of every registered extension, prefixed with `.` — suitable
 * for use directly as the `accept` attribute of a file input, or as the
 * `filters` array of a VS Code quick-pick.
 */
export function getAllAcceptExtensions(): string {
  const exts: string[] = [];
  for (const entry of FILE_FORMAT_REGISTRY) {
    for (const ext of entry.extensions) {
      exts.push(`.${ext}`);
    }
  }
  return exts.join(",");
}

function extensionOf(filename: string): string {
  const trimmed = filename.trim();
  const dot = trimmed.lastIndexOf(".");
  return dot >= 0 ? trimmed.slice(dot + 1).toLowerCase() : "";
}

/**
 * Infer a file format from the filename extension. Returns `null` when
 * the extension is unknown or absent — callers must then either prompt
 * the user (page / vsc-ext) or fall back explicitly. This never
 * silently guesses, since a wrong guess routes bytes through the wrong
 * parser and produces confusing error messages rather than a simple
 * "please pick a format" prompt.
 */
export function inferFormatFromFilename(filename: string): FileFormat | null {
  const ext = extensionOf(filename);
  if (!ext) return null;
  for (const entry of FILE_FORMAT_REGISTRY) {
    if (entry.extensions.includes(ext)) {
      return entry.format;
    }
  }
  return null;
}
