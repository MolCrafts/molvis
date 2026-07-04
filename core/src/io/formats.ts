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

export type FileFormat =
  | "pdb"
  | "xyz"
  | "cif"
  | "lammps"
  | "lammps-dump"
  | "sdf"
  | "dcd"
  | "cube"
  | "chgcar"
  | "gro"
  | "mol2"
  | "poscar"
  | "trr"
  | "xtc";

/**
 * Whether a format's reader consumes the file as a UTF-8 string (`"text"`)
 * or as raw bytes (`"binary"`). Determines which payload variant of
 * `FileContent` the eager ingress (`loadFileContent`) accepts and which
 * WASM reader constructor signature is used (`new XReader(content: string)`
 * vs `new XReader(bytes: Uint8Array)`).
 */
export type FormatPayload = "text" | "binary";

/**
 * How a format relates to the streaming-worker ingress
 * (`loadFileStream` + `transport/trajectory_worker/`).
 *
 * - `"eager-only"` — no streaming reader exists; the whole file must be
 *   materialized before parsing. Used by formats whose payload is
 *   structurally indivisible (zarr directory, volumetric grids).
 * - `"streaming-preferred"` — both an eager (`loadFileContent`) and a
 *   streaming (`loadFileStream`) reader exist. Hosts pick by file size /
 *   user intent. The default for everything multi-frame.
 * - `"streaming-only"` — file size or random-access requirements rule
 *   out materializing the whole file at once; eager path is unsupported
 *   and would throw. Reserved for future binary trajectories so big the
 *   eager path makes no sense.
 */
export type StreamingCapability =
  | "eager-only"
  | "streaming-preferred"
  | "streaming-only";

export interface FileFormatDescriptor {
  readonly format: FileFormat;
  readonly label: string;
  readonly description: string;
  readonly extensions: readonly string[];
  /** Whether the reader takes a `string` or `Uint8Array`. */
  readonly payload: FormatPayload;
  /** Whether the streaming-worker path is available for this format. */
  readonly streaming: StreamingCapability;
  /** Whether molrs (via WASM) has a writer for this format (export support). */
  readonly writable: boolean;
}

export const FILE_FORMAT_REGISTRY: readonly FileFormatDescriptor[] = [
  {
    format: "pdb",
    label: "Protein Data Bank",
    description: "RCSB PDB-style ATOM/HETATM records (.pdb, .ent, .brk)",
    extensions: ["pdb", "ent", "brk"],
    payload: "text",
    streaming: "streaming-preferred",
    writable: true,
  },
  {
    format: "xyz",
    label: "XYZ / Extended XYZ",
    description:
      "Cartesian coordinates, optional properties header (.xyz, .extxyz, .exyz)",
    extensions: ["xyz", "extxyz", "exyz"],
    payload: "text",
    streaming: "streaming-preferred",
    writable: true,
  },
  {
    format: "cif",
    label: "Crystallographic Information File",
    description:
      "IUCr CIF / mmCIF — atomic coordinates plus unit cell that becomes simbox (.cif, .mmcif)",
    extensions: ["cif", "mmcif"],
    payload: "text",
    streaming: "eager-only",
    writable: true,
  },
  {
    format: "lammps",
    label: "LAMMPS Data",
    description:
      "LAMMPS data / restart-text file (.data, .lmp, .lammps, .lammpsdata)",
    extensions: ["data", "lmp", "lammps", "lammpsdata"],
    payload: "text",
    streaming: "streaming-preferred",
    writable: true,
  },
  {
    format: "lammps-dump",
    label: "LAMMPS Dump / Trajectory",
    description:
      "LAMMPS dump trajectory (.dump, .lammpstrj, .lmptrj, .lammpsdump)",
    extensions: ["dump", "lammpstrj", "lmptrj", "lammpsdump"],
    payload: "text",
    streaming: "streaming-preferred",
    writable: true,
  },
  {
    format: "sdf",
    label: "MDL Molfile / SDF",
    description:
      "MDL V2000 connection table; multi-record SDF exposes each record as a frame (.sdf, .mol)",
    extensions: ["sdf", "mol"],
    payload: "text",
    streaming: "streaming-preferred",
    writable: false,
  },
  {
    format: "dcd",
    label: "DCD Trajectory",
    description:
      "Binary CHARMM/NAMD-style trajectory; fixed-stride frames after a small header (.dcd)",
    extensions: ["dcd"],
    payload: "binary",
    streaming: "eager-only",
    writable: true,
  },
  {
    format: "cube",
    label: "Gaussian Cube",
    description:
      "Gaussian-style volumetric scalar field with embedded geometry (.cube, .cub)",
    extensions: ["cube", "cub"],
    payload: "text",
    streaming: "eager-only",
    writable: true,
  },
  {
    format: "chgcar",
    label: "VASP CHGCAR",
    description:
      "VASP charge density / spin density (filename CHGCAR or CHGCAR_*; .chgcar accepted for renames)",
    extensions: ["chgcar"],
    payload: "text",
    streaming: "eager-only",
    writable: false,
  },
  {
    format: "gro",
    label: "GROMACS GRO",
    description:
      "GROMACS structure / trajectory; fixed-column atoms + box, coordinates nm\u2192\u00c5 on read (.gro)",
    extensions: ["gro"],
    payload: "text",
    streaming: "eager-only",
    writable: true,
  },
  {
    format: "mol2",
    label: "Tripos MOL2",
    description:
      "Tripos MOL2 connection table; @<TRIPOS> sections, atoms + bonds (.mol2)",
    extensions: ["mol2"],
    payload: "text",
    streaming: "eager-only",
    writable: true,
  },
  {
    format: "poscar",
    label: "VASP POSCAR / CONTCAR",
    description:
      "VASP crystal cell + atoms (filename POSCAR/CONTCAR or .poscar/.contcar/.vasp)",
    extensions: ["poscar", "contcar", "vasp"],
    payload: "text",
    streaming: "eager-only",
    writable: true,
  },
  {
    format: "trr",
    label: "GROMACS TRR",
    description:
      "GROMACS full-precision binary trajectory; coordinates nm\u2192\u00c5 on read (.trr)",
    extensions: ["trr"],
    payload: "binary",
    streaming: "eager-only",
    writable: true,
  },
  {
    format: "xtc",
    label: "GROMACS XTC",
    description:
      "GROMACS compressed binary trajectory; coordinates nm\u2192\u00c5 on read (.xtc)",
    extensions: ["xtc"],
    payload: "binary",
    streaming: "eager-only",
    writable: true,
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

function basenameOf(filename: string): string {
  const trimmed = filename.trim();
  // Handle both POSIX and Windows separators; we only care about the
  // final segment.
  const slash = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return slash >= 0 ? trimmed.slice(slash + 1) : trimmed;
}

/**
 * Infer a file format from the filename. Returns `null` when the format
 * cannot be determined — callers must then either prompt the user (page /
 * vsc-ext) or fall back explicitly. This never silently guesses, since a
 * wrong guess routes bytes through the wrong parser and produces
 * confusing error messages rather than a simple "please pick a format"
 * prompt.
 *
 * Resolution order:
 *  1. Extension-less basename match — currently only VASP CHGCAR files,
 *     whose canonical names are `CHGCAR`, `CHGCAR_sum`, `CHGCAR_diff`, …
 *     (case-sensitive — VASP filenames are uppercase by convention).
 *  2. Lowercased extension match against the registry.
 */
export function inferFormatFromFilename(filename: string): FileFormat | null {
  // 1. Extension-less canonical names.
  const base = basenameOf(filename);
  if (base === "CHGCAR" || base.startsWith("CHGCAR_")) {
    return "chgcar";
  }
  // VASP structure files are conventionally named POSCAR / CONTCAR (with
  // optional suffixes), uppercase and extension-less like CHGCAR.
  if (
    base === "POSCAR" ||
    base === "CONTCAR" ||
    base.startsWith("POSCAR_") ||
    base.startsWith("CONTCAR_")
  ) {
    return "poscar";
  }

  // 2. Extension match.
  const ext = extensionOf(filename);
  if (!ext) return null;
  for (const entry of FILE_FORMAT_REGISTRY) {
    if (entry.extensions.includes(ext)) {
      return entry.format;
    }
  }
  return null;
}

/**
 * Whether the given format's reader consumes raw bytes rather than a
 * UTF-8 string. Used by the eager ingress to pick which `FileContent`
 * variant to expect and by hosts (page / vsc-ext) to decide whether to
 * read the file with `Blob.text()` or `Blob.arrayBuffer()`.
 */
export function isBinaryFormat(format: FileFormat): boolean {
  return describeFormat(format).payload === "binary";
}

/**
 * Whether the given format supports the streaming-worker ingress
 * (`loadFileStream`). Hosts use this to decide between the eager and
 * streaming load paths — typically: `canStream(fmt) && file.size > N`
 * routes through `loadFileStream`, otherwise eager.
 *
 * Acts as a TypeScript type predicate that narrows to the
 * streaming-capable subset of {@link FileFormat}. The streaming worker's
 * `Format` type (in `transport/trajectory_worker/protocol.ts`) and this
 * narrowed type must agree — keep them in sync when a new format is
 * registered with a non-`eager-only` streaming capability.
 */
export function canStream(
  format: FileFormat,
): format is Exclude<
  FileFormat,
  "dcd" | "cif" | "cube" | "chgcar" | "gro" | "mol2" | "poscar" | "trr" | "xtc"
> {
  return describeFormat(format).streaming !== "eager-only";
}

/**
 * Whether the given format ONLY supports streaming and has no eager
 * fallback. Hosts must reject the eager path for these formats with a
 * clear error rather than silently failing.
 */
export function isStreamingOnly(format: FileFormat): boolean {
  return describeFormat(format).streaming === "streaming-only";
}
