/**
 * Geometric secondary-structure assignment from CA-only backbone
 * coordinates ("DSSP-lite").
 *
 * Real DSSP uses backbone hydrogen-bond patterns to distinguish 3_10,
 * α, π helices and parallel/antiparallel sheets. We don't have the
 * full backbone (only CA, optionally O), so we use a simpler local
 * geometry test on consecutive Cα positions:
 *
 * - Cα(i-1)–Cα(i)–Cα(i+1) bond angle θ
 * - Cα(i-1)–Cα(i)–Cα(i+1)–Cα(i+2) virtual torsion τ
 *
 * Assignment per Rohl & Doolittle / Kabsch & Sander references:
 *
 * | Class | θ (deg) | τ (deg)        |
 * |-------|---------|----------------|
 * | helix | 80–105  | 30–70          |
 * | sheet | 110–145 | abs(τ) >= 130  |
 * | coil  | else                     |
 *
 * Single-residue helix/sheet "noise" is filtered by requiring runs
 * of at least 4 consecutive helix or 3 consecutive sheet residues —
 * shorter stretches are demoted to coil. Boundary residues (no
 * neighbour pair to compute θ/τ) default to coil.
 */
import type { Residue, SecondaryStructureType } from "./pdb_backbone";

const MIN_HELIX_RUN = 4;
const MIN_SHEET_RUN = 3;

interface Vec3 {
  x: number;
  y: number;
  z: number;
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function norm(v: Vec3): number {
  return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
}

const RAD2DEG = 180 / Math.PI;

function bondAngleDeg(p1: Vec3, p2: Vec3, p3: Vec3): number {
  const a = sub(p1, p2);
  const b = sub(p3, p2);
  const c = dot(a, b) / (norm(a) * norm(b) || 1);
  return Math.acos(Math.max(-1, Math.min(1, c))) * RAD2DEG;
}

/**
 * Standard IUPAC dihedral angle: τ = atan2(|b2|·b1·(b2×b3), (b1×b2)·(b2×b3))
 * with b1 = p2-p1, b2 = p3-p2, b3 = p4-p3. Returns degrees in (-180, 180].
 * Right-handed α helix gives τ ≈ +49°, antiparallel sheet gives τ ≈ ±170°.
 */
function torsionDeg(p1: Vec3, p2: Vec3, p3: Vec3, p4: Vec3): number {
  const b1 = sub(p2, p1);
  const b2 = sub(p3, p2);
  const b3 = sub(p4, p3);
  const b2n = norm(b2) || 1;
  const y = b2n * dot(b1, cross(b2, b3));
  const x = dot(cross(b1, b2), cross(b2, b3));
  return Math.atan2(y, x) * RAD2DEG;
}

function classifyOne(
  prev: Vec3,
  curr: Vec3,
  next: Vec3,
  next2: Vec3,
): SecondaryStructureType {
  const theta = bondAngleDeg(prev, curr, next);
  const tau = Math.abs(torsionDeg(prev, curr, next, next2));
  if (theta >= 80 && theta <= 105 && tau >= 30 && tau <= 70) return "helix";
  if (theta >= 110 && theta <= 145 && tau >= 130) return "sheet";
  return "coil";
}

/**
 * Demote runs of `target` shorter than `minRun` to coil. `marks` is
 * mutated in place; chain boundaries are passed in `chainStarts` so
 * we never extend a run across them.
 */
function smoothRuns(
  marks: SecondaryStructureType[],
  target: SecondaryStructureType,
  minRun: number,
  chainStarts: ReadonlySet<number>,
): void {
  let i = 0;
  while (i < marks.length) {
    if (marks[i] !== target) {
      i++;
      continue;
    }
    let j = i;
    while (
      j < marks.length &&
      marks[j] === target &&
      (j === i || !chainStarts.has(j))
    ) {
      j++;
    }
    if (j - i < minRun) {
      for (let k = i; k < j; k++) marks[k] = "coil";
    }
    i = j;
  }
}

/**
 * Mutate `rows[i].ss` for every residue based on local CA geometry.
 * `rows` must be ordered by `(chainId, resSeq)` — the same order
 * `BackboneRibbonModifier.apply()` produces.
 */
export function assignSecondaryStructure(rows: Residue[]): void {
  const n = rows.length;
  if (n === 0) return;

  // Boundary residues stay coil; mid-chain ones get classified.
  const marks: SecondaryStructureType[] = new Array(n).fill("coil");
  const chainStarts = new Set<number>([0]);
  for (let i = 1; i < n; i++) {
    if (rows[i].chainId !== rows[i - 1].chainId) chainStarts.add(i);
  }

  for (let i = 1; i < n - 2; i++) {
    if (
      chainStarts.has(i) ||
      chainStarts.has(i + 1) ||
      chainStarts.has(i + 2)
    ) {
      continue;
    }
    // biome-ignore lint/style/noNonNullAssertion: rows are pre-filtered to have ca
    const prev = rows[i - 1].ca!;
    // biome-ignore lint/style/noNonNullAssertion: same
    const curr = rows[i].ca!;
    // biome-ignore lint/style/noNonNullAssertion: same
    const next = rows[i + 1].ca!;
    // biome-ignore lint/style/noNonNullAssertion: same
    const next2 = rows[i + 2].ca!;
    marks[i] = classifyOne(prev, curr, next, next2);
  }

  smoothRuns(marks, "helix", MIN_HELIX_RUN, chainStarts);
  smoothRuns(marks, "sheet", MIN_SHEET_RUN, chainStarts);

  for (let i = 0; i < n; i++) {
    rows[i].ss = marks[i];
  }
}
