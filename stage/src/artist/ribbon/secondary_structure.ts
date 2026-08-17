/**
 * Secondary-structure assignment for cartoon / ribbon — **policy aligned
 * with Mol\*** (`mol-model-props/computed/secondary-structure.ts`).
 *
 * ## Mol\* `auto` (default)
 *
 * 1. **Model SS** — depositor records when present:
 *    - PDB `HELIX` / `SHEET`
 *    - mmCIF `struct_conf` / `struct_sheet_range`
 * 2. Else **DSSP** for atomic models with backbone N/C/O
 *    (Mol\* `dssp/*`, Kabsch & Sander H-bonds).
 * 3. Else **Zhang–Skolnick** CA-distance geometry
 *    (Mol\* `zhang-skolnik.ts`, TM-align NAR 2005).
 *
 * Sources (MIT, molstar/molstar) — do not invent alternate rules.
 */
import { assignDssp, canRunDssp } from "./dssp";
import type {
  Residue,
  SecondaryStructureRange,
  SecondaryStructureType,
} from "./pdb_backbone";

// ── Zhang–Skolnick constants (verbatim from Mol\* zhang-skolnik.ts) ──────
const HELIX_DISTANCES = [5.45, 5.18, 6.37] as const;
const HELIX_DELTA = 2.1;
const SHEET_DISTANCES = [6.1, 10.4, 13.0] as const;
const SHEET_DELTA = 1.42;

export type SsMethod = "model" | "dssp" | "zhang-skolnick";

/**
 * Mol\* `auto` for a residue list that already has CA positions.
 */
export function assignSecondaryStructureAuto(
  rows: Residue[],
  modelRanges?: readonly SecondaryStructureRange[],
): SsMethod {
  if (modelRanges && modelRanges.length > 0) {
    applySsRanges(rows, modelRanges);
    return "model";
  }
  if (canRunDssp(rows) && assignDssp(rows)) {
    return "dssp";
  }
  assignZhangSkolnick(rows);
  return "zhang-skolnick";
}

/**
 * Zhang–Skolnick secondary-structure assignment (Mol\* `computeUnitZhangSkolnik`).
 */
export function assignZhangSkolnick(rows: Residue[]): void {
  const n = rows.length;
  if (n === 0) return;

  let segStart = 0;
  while (segStart < n) {
    let segEnd = segStart + 1;
    while (segEnd < n && rows[segEnd].chainId === rows[segStart].chainId) {
      segEnd++;
    }
    assignZhangSkolnickSegment(rows, segStart, segEnd);
    segStart = segEnd;
  }
}

function caPos(
  rows: Residue[],
  i: number,
): { x: number; y: number; z: number } | null {
  const ca = rows[i].ca;
  return ca ? { x: ca.x, y: ca.y, z: ca.z } : null;
}

function dist(
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number },
): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function zhangSkolnickMatch(
  rows: Residue[],
  segStart: number,
  segEnd: number,
  iLocal: number,
  distances: readonly number[],
  delta: number,
): boolean {
  const len = segEnd - segStart;
  for (let jLocal = Math.max(0, iLocal - 2); jLocal <= iLocal; jLocal++) {
    for (let k = 2; k < 5; k++) {
      // Incomplete window → unclassified, never a vacuous match. Skipping
      // the out-of-range pair instead would let the last residue of a
      // segment satisfy *any* distance profile, and since helix is tested
      // first it would be labelled helix on geometry that was never checked.
      if (jLocal + k >= len) return false;
      const a = caPos(rows, segStart + jLocal);
      const b = caPos(rows, segStart + jLocal + k);
      if (!a || !b) return false;
      const d = dist(a, b);
      if (Math.abs(d - distances[k - 2]) >= delta) return false;
    }
  }
  return true;
}

function assignZhangSkolnickSegment(
  rows: Residue[],
  segStart: number,
  segEnd: number,
): void {
  for (let i = segStart; i < segEnd; i++) {
    const iLocal = i - segStart;
    let ss: SecondaryStructureType = "coil";
    if (
      zhangSkolnickMatch(
        rows,
        segStart,
        segEnd,
        iLocal,
        HELIX_DISTANCES,
        HELIX_DELTA,
      )
    ) {
      ss = "helix";
    } else if (
      zhangSkolnickMatch(
        rows,
        segStart,
        segEnd,
        iLocal,
        SHEET_DISTANCES,
        SHEET_DELTA,
      )
    ) {
      ss = "sheet";
    }
    rows[i].ss = ss;
  }
}

function baseChainId(chainId: string): string {
  const i = chainId.indexOf("__brk");
  return i >= 0 ? chainId.slice(0, i) : chainId;
}

/**
 * Apply depositor HELIX/SHEET (Mol\* model SS) onto residue rows.
 */
export function applySsRanges(
  rows: Residue[],
  ranges: readonly SecondaryStructureRange[],
): number {
  if (rows.length === 0 || ranges.length === 0) return 0;

  for (const r of rows) r.ss = "coil";

  const byChain = new Map<string, SecondaryStructureRange[]>();
  for (const range of ranges) {
    if (range.type === "coil") continue;
    const list = byChain.get(range.chainId);
    if (list) list.push(range);
    else byChain.set(range.chainId, [range]);
  }

  let assigned = 0;
  for (const r of rows) {
    const list = byChain.get(baseChainId(r.chainId));
    if (!list) continue;
    let ss: SecondaryStructureType = "coil";
    for (const range of list) {
      if (r.resSeq >= range.startResSeq && r.resSeq <= range.endResSeq) {
        if (range.type === "sheet") {
          ss = "sheet";
          break;
        }
        if (range.type === "helix") ss = "helix";
      }
    }
    r.ss = ss;
    if (ss !== "coil") assigned++;
  }
  return assigned;
}
