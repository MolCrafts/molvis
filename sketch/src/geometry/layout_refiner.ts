/**
 * Overlap resolution for a laid-out molecular graph.
 *
 * The constructive pass in `MoleculeLayout` places every atom once, at fixed
 * angles, so bulky neighbours on one centre (a CF₃ next to an aryl on an sp³
 * ring carbon) or a substituent reaching back over a ring system can land on
 * top of each other. This pass repairs that the way classical depiction
 * toolkits do: it only moves whole groups hanging off an acyclic bond, so
 * ring geometry and bond lengths are never touched. For each acyclic bond on
 * the graph path between two atoms that crowd each other it tries
 *
 * - the smaller side of the bond reflected across the bond axis (keeps every
 *   angle), or turned about the bond's other end by ±15°…±60°;
 * - when the bond ends in an acyclic branch point (the C of a CF₃, a
 *   quaternary N), that point's own substituents spun together about it.
 *
 * The single move that lowers the crowding score most is applied, and this
 * repeats until no move helps. The score counts non-bonded atoms closer than
 * one bond, atoms sitting on a bond they are not part of, crossing bonds, and
 * angles squeezed below 80° at a centre.
 */

import {
  distance,
  type Point,
  reflect,
  rotate,
  segmentDistance,
} from "./plane";

/** Non-bonded atoms closer than this (bond lengths) crowd each other. */
const ATOM_ATOM_RANGE = 1;
/**
 * Two atoms on one centre closer than this (bond lengths) make an angle under
 * 80°, the narrowest the constructive pass draws; the score resists
 * squeezing a centre further to make room.
 */
const GEMINAL_RANGE = 2 * Math.sin((40 * Math.PI) / 180);
/** An atom closer than this (bond lengths) to a foreign bond sits on it. */
const ATOM_BOND_RANGE = 0.5;
/** Score of one bond crossing, against at most 1 for one atom pair. */
const CROSSING_WEIGHT = 1;
/** Rotation steps tried about a pivot, in degrees. */
const ROTATION_STEPS_DEG = [15, 30, 45, 60];
/** Score charged per radian a turn bends an angle, so flips win ties. */
const ROTATION_COST = 0.05;
/** Smallest score drop that counts as an improvement. */
const MIN_GAIN = 1e-6;
/** Moves applied per atom before giving up on a stubborn overlap. */
const MOVES_PER_ATOM = 2;

/** A rigid group of atoms and how it may move. */
interface Motion {
  atoms: readonly number[];
  /** Fixed point of the turns. */
  pivot: number;
  /** With `pivot`, the mirror axis of the flip; `null` when it cannot flip. */
  axis: number | null;
  /** Whether turning bends an angle that must stay straight (`sp`). */
  rigid: boolean;
}

interface Candidate {
  atoms: readonly number[];
  points: Point[];
  cost: number;
}

/**
 * Positions with overlaps resolved. `rotatable` lists the bonds a group may
 * move about: the acyclic (bridge) bonds of the graph. Atoms in `linear`
 * (`sp` centres) are never bent: a group hanging off one only flips.
 * Returns new points; the input is not modified.
 */
export function refineLayout(
  points: readonly Point[],
  bonds: ReadonlyArray<readonly [number, number]>,
  rotatable: ReadonlyArray<readonly [number, number]>,
  length: number,
  linear: ReadonlySet<number> = new Set(),
): Point[] {
  return new Refiner(points, bonds, rotatable, length, linear).run();
}

class Refiner {
  private readonly pos: Point[];
  private readonly n: number;
  private readonly adjacency: number[][];
  private readonly bondsOf: number[][];
  private readonly bonded = new Set<number>();
  /** Pairs of atoms bonded to a common atom (and not to each other). */
  private readonly geminal = new Set<number>();
  private readonly motions = new Map<number, Motion[]>();

  constructor(
    points: readonly Point[],
    private readonly bonds: ReadonlyArray<readonly [number, number]>,
    rotatable: ReadonlyArray<readonly [number, number]>,
    private readonly length: number,
    private readonly linear: ReadonlySet<number>,
  ) {
    this.n = points.length;
    this.pos = points.map((p) => ({ x: p.x, y: p.y }));
    this.adjacency = Array.from({ length: this.n }, (): number[] => []);
    this.bondsOf = Array.from({ length: this.n }, (): number[] => []);
    bonds.forEach(([i, j], index) => {
      this.adjacency[i].push(j);
      this.adjacency[j].push(i);
      this.bondsOf[i].push(index);
      this.bondsOf[j].push(index);
      this.bonded.add(this.key(i, j));
    });
    for (const neighbors of this.adjacency) {
      for (const a of neighbors) {
        for (const b of neighbors) {
          if (a < b && !this.bonded.has(this.key(a, b))) {
            this.geminal.add(this.key(a, b));
          }
        }
      }
    }
    const acyclic = new Set(rotatable.map(([i, j]) => this.key(i, j)));
    for (const [i, j] of rotatable) {
      this.motions.set(this.key(i, j), this.motionsOf(i, j, acyclic));
    }
  }

  run(): Point[] {
    if (this.motions.size === 0) return this.pos;
    const budget = MOVES_PER_ATOM * this.n;
    for (let step = 0; step < budget; step++) {
      const move = this.bestMove();
      if (!move) break;
      move.atoms.forEach((atom, k) => {
        this.pos[atom] = move.points[k];
      });
    }
    return this.pos;
  }

  private key(i: number, j: number): number {
    return i < j ? i * this.n + j : j * this.n + i;
  }

  /** Atoms reachable from `from` without crossing bond (from, blocked). */
  private side(from: number, blocked: number): number[] {
    const seen = new Set([from, blocked]);
    const out = [from];
    for (let head = 0; head < out.length; head++) {
      for (const w of this.adjacency[out[head]]) {
        if (seen.has(w)) continue;
        seen.add(w);
        out.push(w);
      }
    }
    return out;
  }

  /** The moves acyclic bond (i, j) offers; see the module comment. */
  private motionsOf(i: number, j: number, acyclic: Set<number>): Motion[] {
    const sideJ = this.side(j, i);
    const sideI = this.side(i, j);
    const [pivot, root, atoms] =
      sideJ.length <= sideI.length ? [i, j, sideJ] : [j, i, sideI];
    const out: Motion[] = [
      {
        atoms,
        pivot,
        axis: atoms.length > 1 ? root : null,
        rigid: this.linear.has(pivot),
      },
    ];
    // Spin a branch point's substituents about it. Ring atoms are left out:
    // spinning a ring about one of its atoms would tilt it off its bond.
    const others = this.adjacency[root].filter((w) => w !== pivot);
    const acyclicCentre = this.adjacency[root].every((w) =>
      acyclic.has(this.key(root, w)),
    );
    if (others.length >= 2 && acyclicCentre && !this.linear.has(root)) {
      out.push({
        atoms: atoms.filter((atom) => atom !== root),
        pivot: root,
        axis: null,
        rigid: false,
      });
    }
    return out;
  }

  private bestMove(): Candidate | null {
    let best: Candidate | null = null;
    let bestGain = MIN_GAIN;
    for (const motion of this.candidateMotions()) {
      const now = this.score(motion.atoms, this.currentOf(motion.atoms));
      for (const candidate of this.moves(motion)) {
        const gain =
          now - this.score(candidate.atoms, candidate.points) - candidate.cost;
        if (gain > bestGain) {
          bestGain = gain;
          best = candidate;
        }
      }
    }
    return best;
  }

  private currentOf(atoms: readonly number[]): Point[] {
    return atoms.map((atom) => this.pos[atom]);
  }

  /** Motions on the graph paths between every crowding pair of atoms. */
  private candidateMotions(): Motion[] {
    const found = new Map<number, Motion[]>();
    for (const [a, b] of this.crowdedPairs()) {
      const path = this.path(a, b);
      for (let k = 0; k + 1 < path.length; k++) {
        const key = this.key(path[k], path[k + 1]);
        const motions = this.motions.get(key);
        if (motions) found.set(key, motions);
      }
    }
    return [...found.values()].flat();
  }

  private crowdedPairs(): Array<[number, number]> {
    const out: Array<[number, number]> = [];
    const near = ATOM_ATOM_RANGE * this.length;
    for (let i = 0; i < this.n; i++) {
      for (let j = i + 1; j < this.n; j++) {
        if (this.bonded.has(this.key(i, j))) continue;
        if (distance(this.pos[i], this.pos[j]) < near) out.push([i, j]);
      }
    }
    const onBond = ATOM_BOND_RANGE * this.length;
    for (const [i, j] of this.bonds) {
      for (let k = 0; k < this.n; k++) {
        if (k === i || k === j) continue;
        if (segmentDistance(this.pos[k], this.pos[i], this.pos[j]) < onBond) {
          out.push([k, i]);
        }
      }
    }
    for (let p = 0; p < this.bonds.length; p++) {
      for (let q = p + 1; q < this.bonds.length; q++) {
        if (this.crosses(p, q, (atom) => this.pos[atom])) {
          out.push([this.bonds[p][0], this.bonds[q][0]]);
        }
      }
    }
    return out;
  }

  /** Shortest graph path a → b (BFS), both ends included. */
  private path(a: number, b: number): number[] {
    const parent = new Int32Array(this.n).fill(-1);
    parent[a] = a;
    const queue = [a];
    for (let head = 0; head < queue.length && parent[b] < 0; head++) {
      for (const w of this.adjacency[queue[head]]) {
        if (parent[w] >= 0) continue;
        parent[w] = queue[head];
        queue.push(w);
      }
    }
    if (parent[b] < 0) return [];
    const out = [b];
    for (let cursor = b; cursor !== a; ) {
      cursor = parent[cursor];
      out.push(cursor);
    }
    return out.reverse();
  }

  /** The flip and the turns of one motion, with their costs. */
  private moves(motion: Motion): Candidate[] {
    const pivot = this.pos[motion.pivot];
    const current = this.currentOf(motion.atoms);
    const out: Candidate[] = [];
    if (motion.axis !== null) {
      const axis = this.pos[motion.axis];
      out.push({
        atoms: motion.atoms,
        points: current.map((p) => reflect(p, pivot, axis)),
        cost: 0,
      });
    }
    if (motion.rigid) return out;
    for (const degrees of ROTATION_STEPS_DEG) {
      const angle = (degrees * Math.PI) / 180;
      for (const signed of [angle, -angle]) {
        out.push({
          atoms: motion.atoms,
          points: current.map((p) => rotate(p, pivot, signed)),
          cost: ROTATION_COST * angle,
        });
      }
    }
    return out;
  }

  /**
   * Crowding between `atoms` (at `points`) and the rest of the molecule.
   * Terms inside the group are left out: a rigid move does not change them.
   * Atoms and bonds outside the group's reach are skipped by bounding box.
   */
  private score(atoms: readonly number[], points: readonly Point[]): number {
    const moved = new Map<number, Point>();
    atoms.forEach((atom, k) => {
      moved.set(atom, points[k]);
    });
    const at = (atom: number): Point => moved.get(atom) ?? this.pos[atom];
    const near = ATOM_ATOM_RANGE * this.length;
    const geminal = GEMINAL_RANGE * this.length;
    const onBond = ATOM_BOND_RANGE * this.length;
    const movedBonds = new Set<number>();
    for (const atom of atoms) {
      for (const bond of this.bondsOf[atom]) movedBonds.add(bond);
    }
    const reach = Box.around(
      [...movedBonds].flatMap((index) => this.bonds[index].map(at)),
    ).grow(Math.max(near, geminal));
    const fixedAtoms: number[] = [];
    for (let k = 0; k < this.n; k++) {
      if (!moved.has(k) && reach.holds(this.pos[k])) fixedAtoms.push(k);
    }
    const nearBonds: number[] = [];
    this.bonds.forEach(([i, j], index) => {
      if (reach.meets(at(i), at(j))) nearBonds.push(index);
    });
    let total = 0;
    // Moved atoms against fixed atoms, and against bonds not wholly moved.
    for (const [atom, p] of moved) {
      for (const j of fixedAtoms) {
        const pair = this.key(atom, j);
        if (this.bonded.has(pair)) continue;
        const range = this.geminal.has(pair) ? geminal : near;
        total += shortfall(distance(p, this.pos[j]), range);
      }
      for (const index of nearBonds) {
        const [i, j] = this.bonds[index];
        if (atom === i || atom === j || (moved.has(i) && moved.has(j)))
          continue;
        total += shortfall(segmentDistance(p, at(i), at(j)), onBond);
      }
    }
    // Fixed atoms against bonds that moved, and moved bonds against the rest.
    for (const index of movedBonds) {
      const [i, j] = this.bonds[index];
      for (const k of fixedAtoms) {
        if (k === i || k === j) continue;
        total += shortfall(segmentDistance(this.pos[k], at(i), at(j)), onBond);
      }
      for (const q of nearBonds) {
        if (q === index || (movedBonds.has(q) && q < index)) continue;
        const [c, d] = this.bonds[q];
        if (moved.has(i) && moved.has(j) && moved.has(c) && moved.has(d)) {
          continue;
        }
        if (this.crosses(index, q, at)) total += CROSSING_WEIGHT;
      }
    }
    return total;
  }

  /** Proper crossing of bonds p and q; bonds sharing an atom never cross. */
  private crosses(p: number, q: number, at: (atom: number) => Point): boolean {
    const [a, b] = this.bonds[p];
    const [c, d] = this.bonds[q];
    if (a === c || a === d || b === c || b === d) return false;
    const side = (u: Point, v: Point, w: Point) =>
      (v.x - u.x) * (w.y - u.y) - (v.y - u.y) * (w.x - u.x);
    const [pa, pb, pc, pd] = [at(a), at(b), at(c), at(d)];
    return (
      side(pa, pb, pc) * side(pa, pb, pd) < 0 &&
      side(pc, pd, pa) * side(pc, pd, pb) < 0
    );
  }
}

/** Axis-aligned bounding box. */
class Box {
  private constructor(
    private readonly minX: number,
    private readonly minY: number,
    private readonly maxX: number,
    private readonly maxY: number,
  ) {}

  static around(points: readonly Point[]): Box {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of points) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
    return new Box(minX, minY, maxX, maxY);
  }

  grow(margin: number): Box {
    return new Box(
      this.minX - margin,
      this.minY - margin,
      this.maxX + margin,
      this.maxY + margin,
    );
  }

  holds(p: Point): boolean {
    return (
      p.x >= this.minX &&
      p.x <= this.maxX &&
      p.y >= this.minY &&
      p.y <= this.maxY
    );
  }

  /** Whether the bounding box of segment ab overlaps this box. */
  meets(a: Point, b: Point): boolean {
    return (
      Math.max(a.x, b.x) >= this.minX &&
      Math.min(a.x, b.x) <= this.maxX &&
      Math.max(a.y, b.y) >= this.minY &&
      Math.min(a.y, b.y) <= this.maxY
    );
  }
}

/** Squared relative shortfall of `d` below `range`; 0 when out of range. */
function shortfall(d: number, range: number): number {
  if (d >= range) return 0;
  const s = (range - d) / range;
  return s * s;
}
