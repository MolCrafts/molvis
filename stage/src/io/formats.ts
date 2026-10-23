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
 *   structurally indivisible (mrec store, volumetric grids).
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

/**
 * Product ingest kind. Independent of {@link StreamingCapability}:
 * a format may have a stream *reader* and still be a one-frame structure
 * (LAMMPS data). Only `"trajectory"` files get a frame index / `.molidx`.
 */
export type IngestKind = "structure" | "trajectory";

/** Size at which a *trajectory* prefers the streaming worker over a
 *  whole-content reader. Structures ignore this. */
export const STREAMING_FILE_THRESHOLD_BYTES = 16 * 1024 * 1024;

/** Whole-file materialize of a trajectory at or above this size is
 *  refused. Streamable hosts (page `File` handle) never hit this:
 *  {@link decideIngest} sends those to `"stream"`. */
export const TRAJECTORY_WHOLE_FILE_CAP_BYTES = 512 * 1024 * 1024;

export type IngestDecision =
  | { path: "stream" }
  | { path: "whole-file" }
  | { path: "refuse"; reason: string };

/**
 * Canvas / explorer drop onto a live viewer. An empty scene installs the
 * file as primary (`replace`); a scene that already has data sources **or**
 * mesh overlays stacks the file (`augment`) so topology (LAMMPS data),
 * trajectory (DCD), and an STL packing container compose in either drop
 * order.
 *
 * Mesh overlays are not DataSources — pass their count as
 * `existingMeshCount` so an STL-only scene is not treated as empty.
 * Hosts with a pipeline should prefer {@link sceneDropLoadMode} from
 * `io/index.ts`, which counts both.
 *
 * STL itself never goes through this helper (`isStlPath` first): a mesh
 * has no `LoadMode` and is always additive.
 *
 * @param existingSourceCount — enabled/installed DataSource rows
 * @param existingMeshCount — live Mesh overlay rows (default 0)
 * @returns `"replace"` on a truly empty scene, otherwise `"augment"`
 * @example
 * dropLoadMode(0) // "replace"
 * dropLoadMode(0, 1) // "augment" — mesh-only scene
 * dropLoadMode(1) // "augment"
 */
export function dropLoadMode(
  existingSourceCount: number,
  existingMeshCount = 0,
): "replace" | "augment" {
  return existingSourceCount + existingMeshCount > 0 ? "augment" : "replace";
}

export interface FileFormatDescriptor {
  readonly format: FileFormat;
  readonly label: string;
  readonly description: string;
  readonly extensions: readonly string[];
  /** Whether the reader takes a `string` or `Uint8Array`. */
  readonly payload: FormatPayload;
  /** Whether the streaming-worker path is available for this format. */
  readonly streaming: StreamingCapability;
  /** Structure = one frame, no index. Trajectory = N frames + index. */
  readonly ingest: IngestKind;
  /** Whether molrs (via WASM) has a writer for this format (export support). */
  readonly writable: boolean;
}

export const FILE_FORMAT_REGISTRY: readonly FileFormatDescriptor[] = [
  {
    format: "pdb",
    label: "PDB structure",
    description: "RCSB PDB-style ATOM/HETATM records (.pdb, .ent, .brk)",
    extensions: ["pdb", "ent", "brk"],
    payload: "text",
    streaming: "streaming-preferred",
    ingest: "trajectory",
    writable: true,
  },
  {
    format: "xyz",
    label: "XYZ coords",
    description:
      "Cartesian coordinates, optional properties header (.xyz, .extxyz, .exyz)",
    extensions: ["xyz", "extxyz", "exyz"],
    payload: "text",
    streaming: "streaming-preferred",
    ingest: "trajectory",
    writable: true,
  },
  {
    format: "cif",
    label: "CIF crystal",
    description:
      "IUCr CIF / mmCIF — atomic coordinates plus unit cell that becomes frame.box (.cif, .mmcif)",
    extensions: ["cif", "mmcif"],
    payload: "text",
    streaming: "eager-only",
    ingest: "structure",
    writable: true,
  },
  {
    format: "lammps",
    label: "LAMMPS data",
    description:
      "LAMMPS data / restart-text file (.data, .lmp, .lammps, .lammpsdata)",
    extensions: ["data", "lmp", "lammps", "lammpsdata"],
    payload: "text",
    streaming: "streaming-preferred",
    ingest: "structure",
    writable: true,
  },
  {
    format: "lammps-dump",
    label: "LAMMPS traj",
    description:
      "LAMMPS dump trajectory (.dump, .lammpstrj, .lmptrj, .lammpsdump)",
    extensions: ["dump", "lammpstrj", "lmptrj", "lammpsdump"],
    payload: "text",
    streaming: "streaming-preferred",
    ingest: "trajectory",
    writable: true,
  },
  {
    format: "sdf",
    label: "SDF molecule",
    description:
      "MDL V2000 connection table; multi-record SDF exposes each record as a frame (.sdf, .mol)",
    extensions: ["sdf", "mol"],
    payload: "text",
    streaming: "streaming-preferred",
    ingest: "trajectory",
    writable: false,
  },
  {
    format: "dcd",
    label: "DCD traj",
    description:
      "Binary CHARMM/NAMD-style trajectory; fixed-stride frames after a small header (.dcd)",
    extensions: ["dcd"],
    payload: "binary",
    streaming: "streaming-preferred",
    ingest: "trajectory",
    writable: true,
  },
  {
    format: "cube",
    label: "Gaussian cube",
    description:
      "Gaussian-style volumetric scalar field with embedded geometry (.cube, .cub)",
    extensions: ["cube", "cub"],
    payload: "text",
    streaming: "eager-only",
    ingest: "structure",
    writable: true,
  },
  {
    format: "chgcar",
    label: "VASP charge",
    description:
      "VASP charge density / spin density (filename CHGCAR or CHGCAR_*; .chgcar accepted for renames)",
    extensions: ["chgcar"],
    payload: "text",
    streaming: "eager-only",
    ingest: "structure",
    writable: false,
  },
  {
    format: "gro",
    label: "GROMACS structure",
    description:
      "GROMACS structure / trajectory; fixed-column atoms + box, coordinates nm\u2192\u00c5 on read (.gro)",
    extensions: ["gro"],
    payload: "text",
    streaming: "eager-only",
    ingest: "structure",
    writable: true,
  },
  {
    format: "mol2",
    label: "MOL2 molecule",
    description:
      "Tripos MOL2 connection table; @<TRIPOS> sections, atoms + bonds (.mol2)",
    extensions: ["mol2"],
    payload: "text",
    streaming: "eager-only",
    ingest: "structure",
    writable: true,
  },
  {
    format: "poscar",
    label: "VASP structure",
    description:
      "VASP crystal cell + atoms (filename POSCAR/CONTCAR or .poscar/.contcar/.vasp)",
    extensions: ["poscar", "contcar", "vasp"],
    payload: "text",
    streaming: "eager-only",
    ingest: "structure",
    writable: true,
  },
  {
    format: "trr",
    label: "GROMACS traj",
    description:
      "GROMACS full-precision binary trajectory; coordinates nm\u2192\u00c5 on read (.trr)",
    extensions: ["trr"],
    payload: "binary",
    streaming: "streaming-preferred",
    ingest: "trajectory",
    writable: true,
  },
  {
    format: "xtc",
    label: "GROMACS traj",
    description:
      "GROMACS compressed binary trajectory; coordinates nm\u2192\u00c5 on read (.xtc)",
    extensions: ["xtc"],
    payload: "binary",
    streaming: "streaming-preferred",
    ingest: "trajectory",
    writable: true,
  },
];

/**
 * A directory-store product that is deliberately **not** a
 * {@link FileFormat}. mrec is a Zarr-v3 *encoding*; molvis opens the whole
 * store through molrs's `MrecReader`, never a per-extension parser.
 * Keeping it out of the parser-dispatch {@link FileFormat} union is a pinned
 * invariant (`stage/tests/io/formats.test.ts`): hosts recognise the
 * `.mrec` directory suffix and stream the store — they never route its bytes
 * to a format reader.
 */
export interface DirectoryFormatDescriptor {
  /** Product name molvis shows the user (never the `zarr` encoding). */
  readonly product: "mrec";
  readonly label: string;
  readonly description: string;
  /** Directory-name suffix that identifies the store, including the dot. */
  readonly suffix: string;
  /**
   * File-name suffix of the store's packed single-file form, including the
   * dot. A packed store is one file whose zip entries are the directory's
   * files (stored, never deflated); it opens through the same reader.
   */
  readonly packedSuffix: string;
  /** Directory stores are always streamed as trajectories. */
  readonly ingest: IngestKind;
}

/** Directory-name suffix of an mrec store (a Zarr-v3 tree), including the dot. */
export const MREC_DIR_SUFFIX = ".mrec";

/** File-name suffix of a packed mrec store (`*.mrec.zip`), including the dot. */
export const MREC_ZIP_SUFFIX = ".mrec.zip";

/** Compound file-name suffix of a LAMMPS `dump local` topology overlay. */
export const DUMP_LOCAL_SUFFIX = ".dump.local";

/** File-name suffix of an STL triangle mesh, including the dot. */
export const STL_SUFFIX = ".stl";

/**
 * Whether `filePath` names an STL triangle mesh.
 *
 * STL is deliberately absent from {@link FILE_FORMAT_REGISTRY}: it carries no
 * atoms, so no reader turns it into a `Frame` and it never becomes a
 * `DataSource`. It opens as scene geometry (`io/stl.ts` → `loadMeshOverlay`),
 * the same way an mrec store opens as a store rather than through a format
 * parser. Case-insensitive; either path separator.
 */
export function isStlPath(filePath: string): boolean {
  return filePath.trim().toLowerCase().endsWith(STL_SUFFIX);
}

/**
 * Directory-store products — the directory-shaped sibling of
 * {@link FILE_FORMAT_REGISTRY}. Unioned into {@link getAllAcceptExtensions}
 * so an open dialog / `accept` list offers `.mrec` alongside the file formats.
 */
export const directoryFormats: readonly DirectoryFormatDescriptor[] = [
  {
    product: "mrec",
    label: "mrec store",
    description:
      "molpy record — a Zarr-v3 directory opened as a streaming trajectory (*.mrec/)",
    suffix: MREC_DIR_SUFFIX,
    packedSuffix: MREC_ZIP_SUFFIX,
    ingest: "trajectory",
  },
];

/**
 * Whether `filePath` names a packed mrec store (`*.mrec.zip`). THE single
 * source of truth for the packed form, the way {@link mrecStoreRootPath} is
 * for the directory form. Case-insensitive; either path separator. A packed
 * store is a file: it never has a store root and `mrecStoreRootPath` returns
 * `undefined` for it.
 */
export function isMrecZipPath(filePath: string): boolean {
  return filePath.trim().toLowerCase().endsWith(MREC_ZIP_SUFFIX);
}

/**
 * Whether `filePath` names a LAMMPS `dump local` file (`*.dump.local`).
 * This is a compound two-part suffix; the bare `local` extension is far too
 * broad to register as a format extension, so it is matched here instead.
 */
export function isDumpLocalPath(filePath: string): boolean {
  return filePath.trim().toLowerCase().endsWith(DUMP_LOCAL_SUFFIX);
}

/**
 * Store root of a `*.mrec` directory record, or `undefined`. THE single
 * source of truth for "is this an mrec store?" — every host (the VS Code path
 * matcher, the store-URI collapser, the open dialog) funnels through here
 * instead of re-deriving the `.mrec` rule.
 *
 * Accepts the store itself (`growth.mrec`) and any path inside it
 * (`growth.mrec/zarr.json`, `growth.mrec/trajectory/atoms/x/c/0`), with or
 * without a trailing slash and with either path separator. A packed
 * `*.mrec.zip` archive is a file, not a directory store, and returns
 * `undefined`.
 */
export function mrecStoreRootPath(filePath: string): string | undefined {
  const posix = filePath.replaceAll("\\", "/");
  const trimmed =
    posix.length > 1 && posix.endsWith("/") ? posix.slice(0, -1) : posix;
  const lower = trimmed.toLowerCase();
  const insideMarker = `${MREC_DIR_SUFFIX}/`;
  const inside = lower.lastIndexOf(insideMarker);
  if (inside >= 0) {
    return trimmed.slice(0, inside + MREC_DIR_SUFFIX.length);
  }
  if (lower.endsWith(MREC_DIR_SUFFIX)) {
    return trimmed;
  }
  return undefined;
}

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
  // Directory stores contribute their dotted suffix (`.mrec`) so hosts that
  // build an `accept` list from this offer the store folder too, plus the
  // packed single-file form (`.mrec.zip`).
  for (const dir of directoryFormats) {
    exts.push(dir.suffix, dir.packedSuffix);
  }
  // Compound two-part suffix — not a registered extension, but an open
  // dialog should still offer it alongside the `.mrec` store forms.
  exts.push(DUMP_LOCAL_SUFFIX);
  // Scene geometry rather than a parsed format, for the same reason mrec is
  // listed here rather than in the registry.
  exts.push(STL_SUFFIX);
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
 * Infer a text format from the first few KB of file content.
 * Used when the extension is missing or nonstandard (e.g. `.out` dumps).
 * Returns `null` when the head is ambiguous — caller should prompt.
 */
export function sniffFormatFromTextHead(head: string): FileFormat | null {
  const sample = head.slice(0, 8192);
  // LAMMPS dump: "ITEM: TIMESTEP" is the frame marker (allow leading BOM/ws).
  if (/^\uFEFF?\s*ITEM:\s*TIMESTEP\b/im.test(sample)) {
    return "lammps-dump";
  }
  // LAMMPS data: first non-comment line is often "LAMMPS … data" or a
  // "N atoms" header after optional comments.
  if (
    /^\uFEFF?\s*LAMMPS\b/im.test(sample) &&
    /\batoms\b/i.test(sample) &&
    !/ITEM:\s*TIMESTEP/i.test(sample)
  ) {
    return "lammps";
  }
  // XYZ: first non-empty line is an integer atom count.
  if (/^\uFEFF?\s*\d+\s*(\r?\n)/.test(sample)) {
    return "xyz";
  }
  // PDB
  if (/^\uFEFF?\s*(HEADER|TITLE|ATOM {2}|HETATM|MODEL )/m.test(sample)) {
    return "pdb";
  }
  // GRO
  if (
    /\n\s*\d+\s*\n/.test(sample) &&
    /\d+\.\d+\s+\d+\.\d+\s+\d+\.\d+\s*$/m.test(sample)
  ) {
    // Weak — only when extension already suggested gro; leave null for sniff.
  }
  return null;
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
 *  1. Extension-less basename match — currently only VASP CHGCAR / POSCAR
 *     files, whose canonical names are `CHGCAR`, `CHGCAR_sum`, `POSCAR`, …
 *     (case-sensitive — VASP filenames are uppercase by convention).
 *  2. Compound-suffix match — LAMMPS `dump local` (`*.dump.local`), whose
 *     two-part suffix cannot be expressed as a single registry extension.
 *  3. Lowercased extension match against the registry.
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

  // 2. Compound-suffix match.
  if (isDumpLocalPath(filename)) return "lammps-dump";

  // 3. Extension match.
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
  "cif" | "cube" | "chgcar" | "gro" | "mol2" | "poscar"
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

/** Structure (one frame, no index) vs trajectory (N frames + index). */
export function ingestKind(format: FileFormat): IngestKind {
  return describeFormat(format).ingest;
}

function formatByteSize(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function wholeFileTrajectoryReason(
  format: FileFormat,
  byteLength: number,
): string {
  const label = describeFormat(format).label;
  const size = formatByteSize(byteLength);
  return `Cannot load ${size} trajectory (${label}) as one buffer. This host would copy the whole file into memory.`;
}

/**
 * Host-agnostic ingest router. Structures always open as one frame.
 * Streamable trajectories at/above {@link STREAMING_FILE_THRESHOLD_BYTES}
 * take `"stream"` when the host can range-read. Pass `hostCanRange: false`
 * (VS Code today) so a stream decision that still copies the whole file
 * is refused at {@link TRAJECTORY_WHOLE_FILE_CAP_BYTES}.
 */
export function decideIngest(
  format: FileFormat,
  byteLength: number,
  opts?: { hostCanRange?: boolean },
): IngestDecision {
  if (ingestKind(format) === "structure") {
    return { path: "whole-file" };
  }
  if (canStream(format) && byteLength >= STREAMING_FILE_THRESHOLD_BYTES) {
    if (
      opts?.hostCanRange === false &&
      byteLength >= TRAJECTORY_WHOLE_FILE_CAP_BYTES
    ) {
      return {
        path: "refuse",
        reason: `${wholeFileTrajectoryReason(format, byteLength)} Range open is not available yet.`,
      };
    }
    return { path: "stream" };
  }
  if (byteLength >= TRAJECTORY_WHOLE_FILE_CAP_BYTES) {
    return {
      path: "refuse",
      reason: wholeFileTrajectoryReason(format, byteLength),
    };
  }
  return { path: "whole-file" };
}

/**
 * Column-name spellings a LAMMPS `dump local` file may use for a bond's two
 * endpoints, most specific first, lower-cased for case-insensitive matching.
 *
 * These names are not ours to choose and not guessable. `dump local` writes
 * whatever the dump command was given, so the default header for the usual
 * `compute bond all property/local batom1 batom2 btype` is
 * `c_bond[1] c_bond[2] c_bond[3]` — three columns carrying no meaning at all.
 * Meaningful names exist only once the user has run `dump_modify … colname`.
 *
 * The list therefore mirrors OVITO's LAMMPS-dump-local reader rather than
 * inventing a convention: OVITO recognises `batom1` / `batom2` for the
 * endpoints, and separately maps any column whose name matches one of its own
 * standard bond properties — case-insensitively, spaces removed, with `.A` /
 * `.B` naming the two components of "Particle Identifiers". Anything else it
 * sends to a manual column-mapping dialog, and so does molvis: a wrong guess
 * draws wrong topology in silence, which is worse than asking.
 *
 * Reference: {@link https://www.ovito.org/manual/reference/file_formats/input/lammps_dump_local.html}
 */
export const BOND_ENDPOINT_ALIASES: readonly (readonly [string, string])[] = [
  // `compute property/local` attribute names — what `dump_modify colname` is
  // conventionally used to restore, and what molrs's own
  // `write_lammps_dump_local` emits.
  ["batom1", "batom2"],
  // OVITO's standard-property spelling: the two components of its
  // "Particle Identifiers" bond property, spaces removed.
  ["particleidentifiers.a", "particleidentifiers.b"],
];

/**
 * The two endpoint columns among `columns`, in `atomi`/`atomj` order and in
 * the file's own spelling, or `undefined` when none of
 * {@link BOND_ENDPOINT_ALIASES} is present — in which case the caller must
 * ask the user rather than guess.
 */
export function matchBondEndpointColumns(
  columns: readonly string[],
): readonly [string, string] | undefined {
  const bySpelling = new Map<string, string>();
  for (const column of columns) {
    // First spelling wins, so a file carrying both `batom1` and `BATOM1`
    // resolves to whichever the reader saw first rather than flipping.
    const key = column.toLowerCase();
    if (!bySpelling.has(key)) bySpelling.set(key, column);
  }
  for (const [atomi, atomj] of BOND_ENDPOINT_ALIASES) {
    const atomiSource = bySpelling.get(atomi);
    const atomjSource = bySpelling.get(atomj);
    if (atomiSource !== undefined && atomjSource !== undefined) {
      return [atomiSource, atomjSource];
    }
  }
  return undefined;
}

/**
 * `dump local` section label LAMMPS records for rows that are bonds.
 *
 * `ENTRIES` is the default label and says nothing about content; `BONDS` is
 * what OVITO's manual tells users to set (`dump_modify … label BONDS`), and
 * is the only reliable signal that a local block holds bond topology, since
 * the column names carry none.
 */
export const DUMP_LOCAL_BONDS_LABEL = "BONDS";
