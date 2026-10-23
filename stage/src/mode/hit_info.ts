/**
 * Hover overlay text for a pick hit.
 *
 * Identity and extras are Frame reverse-lookup on the atoms block. XYZ is the
 * SceneIndex canvas position on the hit meta — never block `x`/`y`/`z`.
 */

import { toRowIndex } from "@molcrafts/molvis-core";
import { DisplayNumber } from "@molcrafts/molvis-core/display-number";
import type { Block } from "@molcrafts/molvis-core/molrs";
import type { AtomMeta, BondMeta } from "../entity_source";
import { formatBondLabel } from "../utils/bond_order";
import { DType, isFloatColumn, isNumericDtype } from "../utils/dtype";

/**
 * Pick result for {@link formatHitInfo}. {@link import("./types").SceneHit} is
 * structurally assignable; extra fields (`mesh`, `thinInstanceIndex`) are
 * allowed so tests do not need Babylon.
 */
export type HitInfo =
  | { type: "atom"; metadata: AtomMeta }
  | { type: "bond"; metadata: BondMeta }
  | { type: "ribbon"; chainId: string; resName: string; resSeq: number }
  | { type: "empty" };

const ATOM_LINE_KEYS = new Set([
  "id",
  "element",
  "x",
  "y",
  "z",
  "xu",
  "yu",
  "zu",
]);
const RESIDUE_KEYS = new Set(["res_name", "res_id", "chain"]);

/**
 * Format a hover line. `atoms` is the trajectory atoms block, or omitted when
 * the hit has no Frame reverse-lookup.
 */
export function formatHitInfo(
  hit: HitInfo | null,
  atoms?: Block | null,
  bondEnds?: readonly [number, number] | null,
): string {
  if (!hit || hit.type === "empty") return "";
  if (hit.type === "ribbon") {
    return `Residue ${hit.resName} ${hit.resSeq} · chain ${hit.chainId}`;
  }
  if (hit.type === "bond")
    return formatBondLine(hit.metadata, bondEnds ?? null);
  return formatAtomLine(hit.metadata, atoms ?? null);
}

function formatBondLine(
  meta: BondMeta,
  ends: readonly [number, number] | null,
): string {
  const length = Math.hypot(
    meta.end.x - meta.start.x,
    meta.end.y - meta.start.y,
    meta.end.z - meta.start.z,
  );
  const kind = formatBondLabel(meta.bondType, meta.bondNumber);
  const pair = ends ? `${ends[0]}–${ends[1]}` : "";
  return pair
    ? `Bond ${pair} · ${length.toFixed(2)} Å · ${kind}`
    : `Bond · ${length.toFixed(2)} Å · ${kind}`;
}

/**
 * Three lines. Line one leads with the atom id, then residue and element.
 * Line two is the canvas position. Everything else — name, type, charge,
 * then the remaining columns — shares the third line.
 */
function formatAtomLine(meta: AtomMeta, atoms: Block | null): string {
  const row = meta.atomId;
  const inBlock = atoms !== null && row >= 0 && row < atoms.nRows;
  const block = inBlock ? atoms : null;
  const residue = block ? residuePrefix(block, row) : null;
  const element = atomElement(meta, block, row);
  const parts: string[] = [`Atom ${atomDisplayId(meta, block, row)}`];
  if (residue) parts.push(residue);
  if (element) parts.push(element);
  const identity = parts.join(" · ");
  const { x, y, z } = meta.position;
  const xyzRow = `XYZ (${x.toFixed(2)}, ${y.toFixed(2)}, ${z.toFixed(2)})`;
  const extras = block ? formatExtraLines(block, row, residue !== null) : [];
  return [identity, xyzRow, ...extras].join("\n");
}

function atomDisplayId(
  meta: AtomMeta,
  atoms: Block | null,
  row: number,
): number {
  if (!atoms) return meta.atomId;
  // molrs pins `id` to domain uint / u64 (schema rejects an i32 write).
  if (atoms.has("id")) return toRowIndex(atoms.view("id")[row]);
  return meta.atomId;
}

/**
 * Chemical identity for the name line — an element symbol only. Force-field
 * kinds (`type`, `type_id`) are not names; they surface as keyed data rows.
 */
function atomElement(
  meta: AtomMeta,
  atoms: Block | null,
  row: number,
): string | undefined {
  const fromMeta = meta.element.trim();
  if (fromMeta) return fromMeta;
  if (!atoms) return undefined;
  if (atoms.has("element")) {
    const el = String((atoms.copy("element") as string[])[row] ?? "").trim();
    if (el) return el;
  }
  return undefined;
}

/** `THR 222 · chain A` when both `res_name` and `res_id` exist. */
function residuePrefix(atoms: Block, row: number): string | null {
  if (!atoms.has("res_name") || !atoms.has("res_id")) return null;
  const resName = (atoms.copy("res_name") as string[])[row]?.trim();
  if (!resName) return null;
  const resId = atoms.view("res_id")[row];
  const chain = atoms.has("chain")
    ? (atoms.copy("chain") as string[])[row]?.trim() || "A"
    : "A";
  return `${resName} ${resId} · chain ${chain}`;
}

const NUMERIC_VECTOR_SUFFIX = /^(.+)_([123])$/;
/** `vx`/`vy`/`vz`, `bond_x`/`bond_y`/`bond_z` — LAMMPS-style named triplets. */
const AXIAL_VECTOR_SUFFIX = /^(.+?)_?([xyz])$/;
const MAX_EXTRA_VALUE = 48;

/** Fields a hover answers before the long tail. Earlier rank leads line three. */
const LEADING_EXTRAS = [
  "name",
  "type",
  "type_id",
  "charge",
  "mass",
  "occupancy",
  "beta",
  "bfactor",
  "tempfactor",
];

function atomExtras(
  atoms: Block,
  row: number,
  residueShown: boolean,
): ExtraEntry[] {
  const extras: ExtraEntry[] = [];
  for (const key of atoms.keys() as string[]) {
    if (skipExtraKey(key, residueShown)) continue;
    const formatted = formatCell(atoms, key, row);
    if (formatted === undefined || formatted === "" || formatted === "_") {
      continue;
    }
    extras.push({ key, value: formatted });
  }
  return groupVectorExtras(extras);
}

type ExtraEntry = { key: string; value: string; vector?: boolean };
type VectorPart = { slot: number; key: string; value: string };

/**
 * Fold complete vector triplets (`forces_1..3`, `vx/vy/vz`) onto one row at
 * the first component's position. Incomplete triplets keep their own rows and
 * their original keys — nothing is invented and nothing is renamed.
 */
function groupVectorExtras(extras: ExtraEntry[]): ExtraEntry[] {
  // slot order: numeric suffix maps 1→0, 2→1, 3→2; axial x→0, y→1, z→2.
  const byPrefix = new Map<string, VectorPart[]>();
  const complete = new Map<string, string>(); // prefix → folded value
  for (const extra of extras) {
    const numeric = NUMERIC_VECTOR_SUFFIX.exec(extra.key);
    const axial = numeric ? null : AXIAL_VECTOR_SUFFIX.exec(extra.key);
    const match = numeric ?? axial;
    if (!match) continue;
    const prefix = (match[1] as string).replace(/_$/, "");
    const slot = numeric
      ? Number(match[2]) - 1
      : { x: 0, y: 1, z: 2 }[match[2] as "x" | "y" | "z"];
    const parts = byPrefix.get(prefix) ?? [];
    parts.push({ slot, key: extra.key, value: extra.value });
    byPrefix.set(prefix, parts);
  }
  for (const [prefix, parts] of byPrefix) {
    if (parts.length !== 3) continue;
    const ordered = [...parts].sort((a, b) => a.slot - b.slot);
    if (ordered.map((p) => p.slot).join() !== "0,1,2") continue;
    complete.set(prefix, `(${ordered.map((p) => p.value).join(", ")})`);
  }

  const folded: ExtraEntry[] = [];
  const emitted = new Set<string>();
  for (const extra of extras) {
    const match =
      NUMERIC_VECTOR_SUFFIX.exec(extra.key) ??
      AXIAL_VECTOR_SUFFIX.exec(extra.key);
    if (!match) {
      folded.push(extra);
      continue;
    }
    const prefix = (match[1] as string).replace(/_$/, "");
    const foldedValue = complete.get(prefix);
    if (foldedValue === undefined) {
      folded.push(extra);
      continue;
    }
    if (emitted.has(prefix)) continue;
    emitted.add(prefix);
    folded.push({ key: prefix, value: foldedValue, vector: true });
  }
  return folded;
}

function formatExtraLines(
  atoms: Block,
  row: number,
  residueShown: boolean,
): string[] {
  const extras = orderExtras(atomExtras(atoms, row, residueShown));
  if (extras.length === 0) return [];
  return [extras.map(formatExtraToken).join(" · ")];
}

function orderExtras(extras: ExtraEntry[]): ExtraEntry[] {
  const rank = new Map(LEADING_EXTRAS.map((key, index) => [key, index]));
  const tail = LEADING_EXTRAS.length;
  return extras
    .map((extra, index) => ({ extra, index }))
    .sort((a, b) => {
      const ra = rank.get(a.extra.key) ?? tail + a.index;
      const rb = rank.get(b.extra.key) ?? tail + b.index;
      return ra - rb;
    })
    .map((item) => item.extra);
}

function formatExtraToken(extra: ExtraEntry): string {
  const value =
    extra.value.length > MAX_EXTRA_VALUE
      ? `${extra.value.slice(0, MAX_EXTRA_VALUE - 1)}…`
      : extra.value;
  return `${extra.key} ${value}`;
}

function skipExtraKey(key: string, residueShown: boolean): boolean {
  if (ATOM_LINE_KEYS.has(key) || key.startsWith("__")) return true;
  return residueShown && RESIDUE_KEYS.has(key);
}

function formatCell(
  atoms: Block,
  key: string,
  row: number,
): string | undefined {
  const dtype = atoms.has(key) ? atoms.dtype(key) : undefined;
  if (isNumericDtype(dtype)) {
    const value = atoms.view(key)[row];
    return isFloatColumn(dtype) ? formatFloat(Number(value)) : String(value);
  }
  if (dtype === DType.String) {
    const value = (atoms.copy(key) as string[])[row];
    return value == null ? undefined : String(value);
  }
  return undefined;
}

function formatFloat(n: number): string {
  return new DisplayNumber(n).science();
}
