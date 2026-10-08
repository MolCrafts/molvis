import type { Block, Frame } from "@molcrafts/molvis-core/molrs";
import { DType } from "../utils/dtype";
import { lammpsCellFromBox } from "./box_lammps";

/**
 * LAMMPS dump files may declare coordinates under several column names
 * depending on the `dump` command options. We map them all back to the
 * canonical `x/y/z` that the rest of MolVis expects.
 *
 * Priority order per axis (first match wins):
 *   1. canonical real cartesian      (`x`, `y`, `z`)
 *   2. unwrapped real cartesian      (`xu`, `yu`, `zu`)
 *   3. scaled (fractional)           (`xs`, `ys`, `zs`)
 *   4. scaled + unwrapped            (`xsu`, `ysu`, `zsu`)
 */
const AXIS_PRIORITY = {
  x: ["x", "xu", "xs", "xsu"],
  y: ["y", "yu", "ys", "ysu"],
  z: ["z", "zu", "zs", "zsu"],
} as const;

const SCALED_SOURCES: ReadonlySet<string> = new Set([
  "xs",
  "xsu",
  "ys",
  "ysu",
  "zs",
  "zsu",
]);

type Axis = keyof typeof AXIS_PRIORITY;

function isFloatColumn(block: Block, key: string): boolean {
  return block.has(key) && block.dtype(key) === DType.Float;
}

function pickSource(block: Block, axis: Axis): string | undefined {
  for (const key of AXIS_PRIORITY[axis]) {
    // Only float columns — the coordinate readers want a Float64Array.
    if (isFloatColumn(block, key)) return key;
  }
  return undefined;
}

/**
 * Ensure the frame's `atoms` block exposes `x/y/z` real-cartesian columns.
 *
 * No-op when the canonical columns are already present. When they're not
 * (as happens for LAMMPS dumps emitted with `dump ... xu yu zu` or
 * `xs ys zs`), the first available fallback is read and — if the source is
 * a scaled variant — un-scaled through the simulation box (triclinic tilts
 * included) before being written back as `x/y/z`.
 *
 * Throws when coordinates are absent entirely, when scaled coords are
 * present without a box, or when a partially-scaled/partially-real mix
 * is encountered (that combination has no unambiguous interpretation).
 */
export function normalizeAtomCoords(frame: Frame): void {
  if (!frame.has("atoms")) return;
  const atoms = frame.get("atoms");

  if (
    isFloatColumn(atoms, "x") &&
    isFloatColumn(atoms, "y") &&
    isFloatColumn(atoms, "z")
  ) {
    return;
  }

  const source: Record<Axis, string | undefined> = {
    x: pickSource(atoms, "x"),
    y: pickSource(atoms, "y"),
    z: pickSource(atoms, "z"),
  };

  if (!source.x || !source.y || !source.z) {
    // Soft-skip: keep the frame loadable (dump local, bonds-only, custom
    // column names). Analysis/render that need cartesian x/y/z will fail
    // later with a clearer message. Throwing here used to abort the whole
    // file load as a generic "Failed to load …" with the real reason lost.
    return;
  }

  const scaledFlags = [
    SCALED_SOURCES.has(source.x),
    SCALED_SOURCES.has(source.y),
    SCALED_SOURCES.has(source.z),
  ];
  const allScaled = scaledFlags.every((flag) => flag);
  const anyScaled = scaledFlags.some((flag) => flag);

  if (anyScaled && !allScaled) {
    throw new Error(
      `mixed scaled/real coordinate sources are not supported (${source.x}/${source.y}/${source.z})`,
    );
  }

  const rawX = atoms.copy(source.x) as Float64Array;
  const rawY = atoms.copy(source.y) as Float64Array;
  const rawZ = atoms.copy(source.z) as Float64Array;
  const n = rawX.length;
  const outX = new Float64Array(n);
  const outY = new Float64Array(n);
  const outZ = new Float64Array(n);

  if (allScaled) {
    const box = frame.box;
    if (!box) {
      throw new Error(
        `atoms use scaled coords (${source.x}/${source.y}/${source.z}) but the frame has no simulation box to un-scale with`,
      );
    }
    // LAMMPS diagonal + tilts, not Box.lengths() (vector norms).
    // The Box handle stays with the frame — lammpsCellFromBox only frees
    // the NDArray wrappers it allocated.
    const cell = lammpsCellFromBox(box);
    const [ox, oy, oz] = cell.origin;
    const [lx, ly, lz] = cell.lengths;
    const [xy, xz, yz] = cell.tilts;
    for (let i = 0; i < n; i++) {
      const sx = rawX[i];
      const sy = rawY[i];
      const sz = rawZ[i];
      outX[i] = ox + sx * lx + sy * xy + sz * xz;
      outY[i] = oy + sy * ly + sz * yz;
      outZ[i] = oz + sz * lz;
    }
  } else {
    outX.set(rawX);
    outY.set(rawY);
    outZ.set(rawZ);
  }

  if (source.x !== "x") atoms.set("x", outX);
  if (source.y !== "y") atoms.set("y", outY);
  if (source.z !== "z") atoms.set("z", outZ);
}

/**
 * Column names a reader may emit for the per-atom element symbol when it does
 * not use the canonical `element`. Extended-XYZ files declare their species
 * column after the `Properties=` header (`species:S:1` → a `species` column);
 * some sources use `symbol`. First match wins.
 */
const ELEMENT_ALIASES = ["species", "symbol"] as const;

/**
 * Ensure the frame's `atoms` block exposes a canonical `element` String column.
 *
 * The renderer's per-element coloring, bond perception, RDF analysis, and
 * selection expressions all key off `element` (see
 * `artist/atom_buffer.ts:resolveAtomStyle`). When a reader names that column
 * something else — extended-XYZ emits `species` from `Properties=species:S:1` —
 * those atoms silently fall through to the categorical *type* path and render
 * with a single uniform color instead of per-element CPK colors.
 *
 * Aliases the first present `species`/`symbol` String column to `element`,
 * mirroring the alias handling on the RPC ingress (`transport/rpc/
 * serialization.ts`). No-op when an `element` column already exists or no
 * alias is present. The aliased source column is left in place (harmless;
 * `element` takes priority everywhere downstream).
 */
export function normalizeAtomElements(frame: Frame): void {
  if (!frame.has("atoms")) return;
  const atoms = frame.get("atoms");
  if (atoms.has("element")) return;
  for (const alias of ELEMENT_ALIASES) {
    if (atoms.has(alias) && atoms.dtype(alias) === DType.String) {
      atoms.set("element", atoms.copy(alias) as string[]);
      return;
    }
  }
}
