/**
 * DSSP secondary-structure assignment — logic ported from Mol\*
 * (`mol-model-props/computed/secondary-structure/dssp/*`).
 *
 * H-bond energy (Kabsch & Sander):
 *   E = Q × (1/r(OH) + 1/r(CN) − 1/r(CH) − 1/r(ON)), Q = −27.888
 *   accept if E < −0.5 kcal/mol
 *
 * Then: n-turns → helices (G/H/I) → bridges → ladders → sheets (E/B).
 *
 * Input is our CA-ordered residue rows with N/C/O when present (same
 * atoms Mol\* uses for atomic units). Missing backbone → no DSSP
 * (caller falls back to Zhang–Skolnick).
 *
 * Copyright (c) 2019–2024 mol* contributors, MIT — algorithm only.
 */
import type { Residue, SecondaryStructureType } from "./pdb_backbone";

const Q = -27.888;
const HBOND_CUTOFF = -0.5;
const HBOND_MIN = -9.9;
const CA_MAX_DIST = 9.0;
const CA_MAX_DIST_SQ = CA_MAX_DIST * CA_MAX_DIST;

enum Flag {
  H = 0x1,
  B = 0x2,
  E = 0x4,
  G = 0x8,
  I = 0x10,
  S = 0x20,
  T = 0x40,
  T3 = 0x80,
  T4 = 0x100,
  T5 = 0x200,
  T3S = 0x400,
  T4S = 0x800,
  T5S = 0x1000,
}

enum BridgeKind {
  PARALLEL = 0,
  ANTI = 1,
}

interface Bridge {
  p1: number;
  p2: number;
  type: BridgeKind;
}

interface Ladder {
  prev: number;
  next: number;
  firstStart: number;
  firstEnd: number;
  secondStart: number;
  secondEnd: number;
  type: BridgeKind;
}

interface Vec3 {
  x: number;
  y: number;
  z: number;
}

function vdist(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function vdistSq(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}

function hbondEnergy(o: Vec3, c: Vec3, n: Vec3, h: Vec3): number {
  const e =
    Q / vdist(o, h) - Q / vdist(c, h) + Q / vdist(c, n) - Q / vdist(o, n);
  return e < HBOND_MIN ? HBOND_MIN : e;
}

/** Directed H-bonds: CO(i) → NH(j). adjacency[i] = list of j. */
function buildHbonds(rows: Residue[]): number[][] {
  const n = rows.length;
  const adj: number[][] = Array.from({ length: n }, () => []);

  // Positions
  const N: (Vec3 | null)[] = new Array(n);
  const CA: (Vec3 | null)[] = new Array(n);
  const C: (Vec3 | null)[] = new Array(n);
  const O: (Vec3 | null)[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const r = rows[i];
    N[i] = r.n ? { x: r.n.x, y: r.n.y, z: r.n.z } : null;
    CA[i] = r.ca ? { x: r.ca.x, y: r.ca.y, z: r.ca.z } : null;
    C[i] = r.c ? { x: r.c.x, y: r.c.y, z: r.c.z } : null;
    O[i] = r.o ? { x: r.o.x, y: r.o.y, z: r.o.z } : null;
  }

  for (let i = 0; i < n; i++) {
    const oPos = O[i];
    const cPos = C[i];
    const caPos = CA[i];
    if (!oPos || !cPos || !caPos) continue;

    for (let j = 0; j < n; j++) {
      if (j === i || j === i - 1 || j === i + 1) continue;
      // Same chain only (DSSP unit-local; we segment by chain upstream)
      if (rows[j].chainId !== rows[i].chainId) continue;
      const caJ = CA[j];
      const nPos = N[j];
      if (!caJ || !nPos) continue;
      if (vdistSq(caPos, caJ) > CA_MAX_DIST_SQ) continue;

      if (j === 0 || rows[j - 1].chainId !== rows[j].chainId) continue;
      const oPrev = O[j - 1];
      const cPrev = C[j - 1];
      if (!oPrev || !cPrev) continue;
      const dx = cPrev.x - oPrev.x;
      const dy = cPrev.y - oPrev.y;
      const dz = cPrev.z - oPrev.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
      // Approximate H if no amide H: H ≈ N + (C_prev − O_prev)/|C−O|
      const hPos: Vec3 = {
        x: nPos.x + dx / dist,
        y: nPos.y + dy / dist,
        z: nPos.z + dz / dist,
      };

      const e = hbondEnergy(oPos, cPos, nPos, hPos);
      if (e > HBOND_CUTOFF) continue;
      adj[i].push(j);
    }
  }
  return adj;
}

function hasHbond(adj: number[][], from: number, to: number): boolean {
  if (from < 0 || to < 0 || from >= adj.length || to >= adj.length)
    return false;
  return adj[from].includes(to);
}

/**
 * Run DSSP on a single chain segment (contiguous rows, same chainId).
 * Mutates `rows[i].ss` for i in [start, end).
 */
function dsspSegment(rows: Residue[], start: number, end: number): void {
  const len = end - start;
  if (len < 4) {
    for (let i = start; i < end; i++) rows[i].ss = "coil";
    return;
  }

  // Work on local indices 0..len-1 with a view into rows
  const local: Residue[] = rows.slice(start, end);
  const adj = buildHbonds(local);
  const flags = new Uint32Array(len);

  // ── Turns (Mol* assignTurns, oldDefinition=true) ──
  const turnStart = [Flag.T3S, Flag.T4S, Flag.T5S];
  const turnBody = [Flag.T3, Flag.T4, Flag.T5];
  for (let idx = 0; idx < 3; idx++) {
    const n = idx + 3;
    for (let i = 0; i < len - n; i++) {
      if (!hasHbond(adj, i, i + n)) continue;
      flags[i] |= turnStart[idx] | turnBody[idx];
      for (let k = 1; k < n; k++) {
        flags[i + k] |= turnBody[idx] | Flag.T;
      }
    }
  }

  // ── Helices (Mol* assignHelices, oldOrdering: 4 then 3 then 5) ──
  const helixFlag = [0, 0, 0, Flag.G, Flag.H, Flag.I];
  for (const n of [4, 3, 5]) {
    for (let i = 1; i < len - n; i++) {
      const fI = flags[i];
      const fI2 = flags[i + 1];
      // yield rules (oldOrdering)
      if (n === 3 && ((fI & Flag.H) !== 0 || (fI2 & Flag.H) !== 0)) {
        continue;
      }
      if (
        n === 5 &&
        ((fI & (Flag.H | Flag.G)) !== 0 || (fI2 & (Flag.H | Flag.G)) !== 0)
      ) {
        continue;
      }
      const needStart = turnStart[n - 3];
      const needBody = turnBody[n - 3];
      if (
        (fI & needStart) !== 0 &&
        (fI & needBody) !== 0 &&
        (flags[i - 1] & needStart) !== 0 &&
        (flags[i - 1] & needBody) !== 0
      ) {
        for (let k = 0; k < n; k++) {
          flags[i + k] |= helixFlag[n];
        }
      }
    }
  }

  // ── Bridges (Mol* assignBridges) ──
  const bridges: Bridge[] = [];
  for (let k = 0; k < len; k++) {
    for (const l of adj[k]) {
      if (k > l) continue;

      // Parallel: Hbond(i-1,j) and Hbond(j,i+1)
      let i = k + 1;
      let j = l;
      if (i !== j && hasHbond(adj, j, i + 1)) {
        flags[i] |= Flag.B;
        flags[j] |= Flag.B;
        bridges.push({
          p1: Math.min(i, j),
          p2: Math.max(i, j),
          type: BridgeKind.PARALLEL,
        });
      }

      // Parallel: Hbond(j-1,i) and Hbond(i,j+1)
      i = k;
      j = l - 1;
      if (
        i !== j &&
        j >= 0 &&
        hasHbond(adj, j - 1, i) &&
        hasHbond(adj, i, j + 1)
      ) {
        flags[i] |= Flag.B;
        flags[j] |= Flag.B;
        bridges.push({
          p1: Math.min(i, j),
          p2: Math.max(i, j),
          type: BridgeKind.PARALLEL,
        });
      }

      // Antiparallel: Hbond(i,j) and Hbond(j,i)
      i = k;
      j = l;
      if (i !== j && hasHbond(adj, j, i)) {
        flags[i] |= Flag.B;
        flags[j] |= Flag.B;
        bridges.push({
          p1: Math.min(i, j),
          p2: Math.max(i, j),
          type: BridgeKind.ANTI,
        });
      }

      // Antiparallel: Hbond(i-1,j+1) and Hbond(j-1,i+1)
      i = k + 1;
      j = l - 1;
      if (i !== j && j >= 0 && hasHbond(adj, j - 1, i + 1)) {
        // first pattern already needs Hbond(i-1,j+1)=Hbond(k,l) which exists
        flags[i] |= Flag.B;
        flags[j] |= Flag.B;
        bridges.push({
          p1: Math.min(i, j),
          p2: Math.max(i, j),
          type: BridgeKind.ANTI,
        });
      }
    }
  }
  bridges.sort((a, b) => a.p1 - b.p1);

  // ── Ladders (Mol* assignLadders) ──
  const ladders: Ladder[] = [];
  for (const bridge of bridges) {
    let found = false;
    for (const ladder of ladders) {
      if (bridge.type !== ladder.type) continue;
      if (bridge.p1 !== ladder.firstEnd + 1) continue;
      if (
        bridge.type === BridgeKind.PARALLEL &&
        bridge.p2 === ladder.secondEnd + 1
      ) {
        found = true;
        ladder.firstEnd++;
        ladder.secondEnd++;
      } else if (
        bridge.type === BridgeKind.ANTI &&
        bridge.p2 === ladder.secondStart - 1
      ) {
        found = true;
        ladder.firstEnd++;
        ladder.secondStart--;
      }
    }
    if (!found) {
      ladders.push({
        prev: 0,
        next: 0,
        firstStart: bridge.p1,
        firstEnd: bridge.p1,
        secondStart: bridge.p2,
        secondEnd: bridge.p2,
        type: bridge.type,
      });
    }
  }

  // Connect ladders (bulge-linked)
  for (let a = 0; a < ladders.length; a++) {
    for (let b = a; b < ladders.length; b++) {
      const L1 = ladders[a];
      const L2 = ladders[b];
      if (L1.type !== L2.type || L2.next !== 0) continue;
      if (L2.firstStart - L1.firstEnd >= 6 || L1.firstStart >= L2.firstStart)
        continue;
      const ok =
        L1.type === BridgeKind.PARALLEL
          ? L2.secondStart - L1.secondEnd > 0 &&
            ((L2.secondStart - L1.secondEnd < 6 &&
              L2.firstStart - L1.firstEnd < 3) ||
              L2.secondStart - L1.secondEnd < 3)
          : L1.secondStart - L2.secondEnd > 0 &&
            ((L1.secondStart - L2.secondEnd < 6 &&
              L2.firstStart - L1.firstEnd < 3) ||
              L1.secondStart - L2.secondEnd < 3);
      if (ok) {
        L1.next = b;
        L2.prev = a;
      }
    }
  }

  // ── Sheets (Mol* assignSheets) ──
  const isHelix = (f: number) =>
    (f & Flag.G) !== 0 || (f & Flag.H) !== 0 || (f & Flag.I) !== 0;

  for (let li = 0; li < ladders.length; li++) {
    const ladder = ladders[li];
    for (let lcount = ladder.firstStart; lcount <= ladder.firstEnd; lcount++) {
      const diff = ladder.firstStart - lcount;
      const l2count = ladder.secondStart - diff;
      if (ladder.firstStart !== ladder.firstEnd) {
        flags[lcount] |= Flag.E;
        if (l2count >= 0 && l2count < len) flags[l2count] |= Flag.E;
      } else {
        if (!isHelix(flags[lcount]) && (flags[lcount] & Flag.E) !== 0) {
          flags[lcount] |= Flag.B;
        }
        if (
          l2count >= 0 &&
          l2count < len &&
          !isHelix(flags[l2count]) &&
          (flags[l2count] & Flag.E) !== 0
        ) {
          flags[l2count] |= Flag.B;
        }
      }
    }
    if (ladder.next === 0) continue;
    const con = ladders[ladder.next];
    for (let lcount = ladder.firstStart; lcount <= con.firstEnd; lcount++) {
      flags[lcount] |= Flag.E;
    }
    if (ladder.type === BridgeKind.PARALLEL) {
      for (let lcount = ladder.secondStart; lcount <= con.secondEnd; lcount++) {
        if (lcount >= 0 && lcount < len) flags[lcount] |= Flag.E;
      }
    } else {
      for (let lcount = con.secondEnd; lcount <= ladder.secondStart; lcount++) {
        if (lcount >= 0 && lcount < len) flags[lcount] |= Flag.E;
      }
    }
  }

  // ── Priority H > E > B > G > I > T > S (Mol* old ordering) ──
  for (let i = 0; i < len; i++) {
    const f = flags[i];
    let ss: SecondaryStructureType = "coil";
    if ((f & Flag.H) !== 0) ss = "helix";
    else if ((f & Flag.E) !== 0) ss = "sheet";
    else if ((f & Flag.B) !== 0) ss = "sheet";
    else if ((f & Flag.G) !== 0) ss = "helix";
    else if ((f & Flag.I) !== 0) ss = "helix";
    // T/S → coil for cartoon profiles
    rows[start + i].ss = ss;
  }
}

/**
 * Whether the segment has enough backbone atoms for DSSP (N,C,O on most residues).
 */
export function canRunDssp(rows: Residue[]): boolean {
  if (rows.length < 5) return false;
  let ok = 0;
  for (const r of rows) {
    if (r.ca && r.n && r.c && r.o) ok++;
  }
  return ok / rows.length >= 0.5;
}

/**
 * Assign DSSP secondary structure in place. Segments by `chainId`.
 * Returns true if DSSP ran; false if backbone incomplete (caller should
 * fall back to Zhang–Skolnick).
 */
export function assignDssp(rows: Residue[]): boolean {
  if (!canRunDssp(rows)) return false;

  let segStart = 0;
  while (segStart < rows.length) {
    let segEnd = segStart + 1;
    while (
      segEnd < rows.length &&
      rows[segEnd].chainId === rows[segStart].chainId
    ) {
      segEnd++;
    }
    dsspSegment(rows, segStart, segEnd);
    segStart = segEnd;
  }
  return true;
}
