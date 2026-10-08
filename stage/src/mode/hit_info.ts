/**
 * Hover overlay text for a pick hit.
 *
 * Identity and extras are Frame reverse-lookup on the atoms block. XYZ is the
 * SceneIndex canvas position on the hit meta — never block `x`/`y`/`z`.
 */

import { toRowIndex } from "@molcrafts/molvis-core";
import type { Block } from "@molcrafts/molvis-core/molrs";
import type { AtomMeta, BondMeta } from "../entity_source";
import { formatBondLabel } from "../utils/bond_order";
import { DType } from "../utils/dtype";

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
  "type",
  "type_id",
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
): string {
  if (!hit || hit.type === "empty") return "";
  if (hit.type === "ribbon") {
    return `Residue ${hit.resName} ${hit.resSeq} · chain ${hit.chainId}`;
  }
  if (hit.type === "bond") return formatBondLine(hit.metadata);
  return formatAtomLine(hit.metadata, atoms ?? null);
}

function formatBondLine(meta: BondMeta): string {
  const length = Math.hypot(
    meta.end.x - meta.start.x,
    meta.end.y - meta.start.y,
    meta.end.z - meta.start.z,
  );
  const kind = formatBondLabel(meta.bondType, meta.bondNumber);
  return `Bond ${meta.atomId1}–${meta.atomId2} · ${length.toFixed(2)} Å · ${kind}`;
}

function formatAtomLine(meta: AtomMeta, atoms: Block | null): string {
  const row = meta.atomId;
  const inBlock = atoms !== null && row >= 0 && row < atoms.nRows;
  const block = inBlock ? atoms : null;
  const residue = block ? residuePrefix(block, row) : null;
  const species = atomSpecies(meta, block, row);
  const { x, y, z } = meta.position;
  const parts: string[] = [];
  if (residue) parts.push(residue);
  parts.push(`Atom ${atomDisplayId(meta, block, row)}`);
  if (species) parts.push(species);
  parts.push(`XYZ (${x.toFixed(2)}, ${y.toFixed(2)}, ${z.toFixed(2)})`);
  if (block) parts.push(...atomExtras(block, row, residue !== null));
  return parts.join(" · ");
}

function atomDisplayId(
  meta: AtomMeta,
  atoms: Block | null,
  row: number,
): number {
  if (!atoms) return meta.atomId;
  // molrs pins `id` to domain uint / u64 (schema rejects an i32 write).
  if (atoms.has("id") && atoms.dtype("id") === "uint")
    return toRowIndex((atoms.view("id") as BigUint64Array)[row]);
  return meta.atomId;
}

function atomSpecies(
  meta: AtomMeta,
  atoms: Block | null,
  row: number,
): string | undefined {
  const fromMeta = meta.element.trim();
  if (fromMeta) return fromMeta;
  if (!atoms) return undefined;
  if (atoms.has("element") && atoms.dtype("element") === "string") {
    const el = String((atoms.copy("element") as string[])[row] ?? "").trim();
    if (el) return el;
  }
  if (atoms.has("type") && atoms.dtype("type") === "string") {
    const type = String((atoms.copy("type") as string[])[row] ?? "").trim();
    if (type) return type;
  }
  // `type_id` is a LAMMPS u32 ordinal (molrs pins it u32, same as `id`).
  if (atoms.has("type_id") && atoms.dtype("type_id") === "uint")
    return String((atoms.view("type_id") as BigUint64Array)[row]);
  return undefined;
}

/** `THR 222 · chain A` when both `res_name` and `res_id` exist. */
function residuePrefix(atoms: Block, row: number): string | null {
  if (
    !(atoms.has("res_name") && atoms.dtype("res_name") === "string") ||
    !(atoms.has("res_id") && atoms.dtype("res_id") === "uint")
  )
    return null;
  const resName = (
    (atoms.copy("res_name") as string[])[row] as string | undefined
  )?.trim();
  if (!resName) return null;
  const resId = (atoms.view("res_id") as BigUint64Array)[row];
  const chain =
    atoms.has("chain") && atoms.dtype("chain") === "string"
      ? (
          (atoms.copy("chain") as string[])[row] as string | undefined
        )?.trim() || "A"
      : "A";
  return `${resName} ${resId} · chain ${chain}`;
}

function atomExtras(
  atoms: Block,
  row: number,
  residueShown: boolean,
): string[] {
  const extras: string[] = [];
  for (const key of atoms.keys()) {
    if (skipExtraKey(key, residueShown)) continue;
    const formatted = formatCell(atoms, key, row);
    if (formatted === undefined) continue;
    extras.push(`${key} ${formatted}`);
  }
  return extras;
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
  const dtype = atoms.dtype(key);
  if (dtype === DType.Float)
    return formatFloat((atoms.view(key) as Float64Array)[row]);
  if (dtype === DType.Uint)
    return String((atoms.view(key) as BigUint64Array)[row]);
  if (dtype === DType.Int) return String((atoms.view(key) as Int32Array)[row]);
  if (dtype === DType.String) {
    const value = (atoms.copy(key) as string[])[row];
    return value == null ? undefined : String(value);
  }
  return undefined;
}

/** Fixed-decimal, no scientific notation; trim trailing zeros (`-0.83`, `12.01`). */
function formatFloat(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  const trimmed = n.toFixed(8).replace(/\.?0+$/, "");
  return trimmed === "-0" ? "0" : trimmed;
}
