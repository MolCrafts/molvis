import type { Bond2D, MoleculeData, SketchTopology } from "../types";
import { refineLayout } from "./layout_refiner";
import {
  alignLongAxis,
  arcBetween,
  centroid,
  type Point,
  sub,
  unit,
} from "./plane";
import { DEFAULT_BOND_LENGTH } from "./snap";

/** Nearest non-bonded approach, in bond lengths, that counts as a clash. */
const CLASH_DISTANCE = 0.6;
/** Gap between disconnected fragments (ions, solvent), in bond lengths. */
const FRAGMENT_GAP = 1.5;

/**
 * 2D depiction coordinates from a molecular graph — the fallback used when a
 * frame or topology carries no 2D coordinates of its own.
 *
 * Provided coordinates always win ({@link place} keeps them untouched); this
 * only runs when at least one atom has none. It is deliberately a classical
 * depiction pass, not a force-directed optimizer:
 *
 * 1. Ring bonds are the non-bridges of the graph. Each ring system (a
 *    connected set of ring bonds) is laid out on its own: its smallest rings
 *    become regular polygons, fused/bridged rings are closed on arcs across
 *    the shared atoms (bulging to the side that crowds the placed atoms
 *    least), spiro rings hang off the shared atom along the bisector of its
 *    ring bonds, in the mirror image that sends onward bonds away from the
 *    rings already placed.
 * 2. Starting from the largest ring system (or one end of the longest chain),
 *    the rest of the molecule grows outward breadth-first: chains zig-zag at
 *    120°, branches split the free angle evenly, `sp` centres (a triple bond
 *    or cumulated double bonds) stay linear, and a ring system reached through
 *    a substituent is placed as a rigid unit pointing back along that bond.
 *    Of two candidate turns the one that collides with nothing is preferred.
 * 3. Groups hanging off acyclic bonds are flipped, turned or spun until no
 *    atom sits on another atom or bond and no bonds cross, where the ring
 *    systems allow it ({@link refineLayout}).
 * 4. Each fragment is turned so its long axis is horizontal, and fragments
 *    are set side by side, left to right, in atom order.
 *
 * A proper coordinate generator belongs upstream (molpy); when a frame brings
 * 2D coordinates, the sketch uses them and never calls this.
 */
export class MoleculeLayout {
  constructor(private readonly bondLength: number = DEFAULT_BOND_LENGTH) {
    if (!Number.isFinite(bondLength) || bondLength <= 0) {
      throw new Error("bondLength must be a positive finite number");
    }
  }

  /**
   * Complete a topology into a sketch document. When every atom has a finite
   * `x` and `y` they are kept; otherwise every atom is laid out by
   * {@link compute}. Returns new objects; the input is not modified.
   */
  place(topology: SketchTopology): MoleculeData {
    const provided =
      topology.atoms.length > 0 &&
      topology.atoms.every(
        (atom) => Number.isFinite(atom.x) && Number.isFinite(atom.y),
      );
    const points = provided
      ? topology.atoms.map((atom) => ({ x: atom.x ?? 0, y: atom.y ?? 0 }))
      : this.compute(topology.atoms.length, topology.bonds);
    return {
      atoms: topology.atoms.map((atom, index) => ({
        ...atom,
        x: points[index].x,
        y: points[index].y,
      })),
      bonds: topology.bonds.map((bond) => ({ ...bond })),
    };
  }

  /**
   * Coordinates for `atomCount` atoms joined by `bonds`, in document units
   * (one bond = `bondLength`).
   *
   * @throws Error when a bond endpoint is out of range or a self-bond.
   */
  compute(atomCount: number, bonds: readonly Bond2D[]): Point[] {
    if (!Number.isInteger(atomCount) || atomCount < 0) {
      throw new Error(`atomCount must be a non-negative integer`);
    }
    for (const bond of bonds) {
      if (
        !Number.isInteger(bond.i) ||
        !Number.isInteger(bond.j) ||
        bond.i < 0 ||
        bond.j < 0 ||
        bond.i >= atomCount ||
        bond.j >= atomCount ||
        bond.i === bond.j
      ) {
        throw new Error(
          `bond (${bond.i}, ${bond.j}) is invalid for ${atomCount} atoms`,
        );
      }
    }
    return new LayoutRun(atomCount, bonds, this.bondLength).run();
  }
}

/** One layout pass over one graph. Holds the mutable working state. */
class LayoutRun {
  private readonly adjacency: number[][];
  private readonly orders = new Map<number, number>();
  private readonly ringBond = new Set<number>();
  private readonly system: Int32Array;
  private readonly systemLayouts: Array<Map<number, Point>> = [];
  private readonly systemPlaced: boolean[] = [];
  private readonly pos: Array<Point | null>;
  private readonly turn: Int8Array;
  private readonly placedList: number[] = [];

  constructor(
    private readonly n: number,
    bonds: readonly Bond2D[],
    private readonly length: number,
  ) {
    this.adjacency = Array.from({ length: n }, (): number[] => []);
    for (const bond of bonds) {
      const key = this.key(bond.i, bond.j);
      if (this.orders.has(key)) continue;
      this.orders.set(key, bond.order);
      this.adjacency[bond.i].push(bond.j);
      this.adjacency[bond.j].push(bond.i);
    }
    this.system = new Int32Array(n).fill(-1);
    this.pos = new Array<Point | null>(n).fill(null);
    this.turn = new Int8Array(n).fill(1);
  }

  run(): Point[] {
    this.findRingBonds();
    this.layoutRingSystems();
    const fragments: Point[][] = [];
    const fragmentAtoms: number[][] = [];
    for (const component of this.components()) {
      this.layoutComponent(component);
      fragments.push(alignLongAxis(this.refined(component)));
      fragmentAtoms.push(component);
    }
    const out: Point[] = new Array(this.n);
    let cursor = 0;
    for (let f = 0; f < fragments.length; f++) {
      const points = fragments[f];
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      for (const p of points) {
        minX = Math.min(minX, p.x);
        maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y);
        maxY = Math.max(maxY, p.y);
      }
      const dx = cursor - minX;
      const dy = -(minY + maxY) / 2;
      fragmentAtoms[f].forEach((atom, k) => {
        out[atom] = { x: points[k].x + dx, y: points[k].y + dy };
      });
      cursor += maxX - minX + FRAGMENT_GAP * this.length;
    }
    return out;
  }

  /** The component's positions with branch overlaps resolved. */
  private refined(component: readonly number[]): Point[] {
    const index = new Map<number, number>();
    component.forEach((atom, k) => {
      index.set(atom, k);
    });
    const bonds: Array<[number, number]> = [];
    const rotatable: Array<[number, number]> = [];
    const linear = new Set<number>();
    component.forEach((atom, k) => {
      if (this.adjacency[atom].length === 2 && this.isLinear(atom)) {
        linear.add(k);
      }
      for (const w of this.adjacency[atom]) {
        if (w < atom) continue;
        const pair: [number, number] = [k, index.get(w) as number];
        bonds.push(pair);
        if (!this.ringBond.has(this.key(atom, w))) rotatable.push(pair);
      }
    });
    return refineLayout(
      component.map((atom) => this.pos[atom] as Point),
      bonds,
      rotatable,
      this.length,
      linear,
    );
  }

  private key(i: number, j: number): number {
    return i < j ? i * this.n + j : j * this.n + i;
  }

  private order(i: number, j: number): number {
    return this.orders.get(this.key(i, j)) ?? 1;
  }

  /** Connected components, each in ascending atom order. */
  private components(): number[][] {
    const seen = new Uint8Array(this.n);
    const out: number[][] = [];
    for (let start = 0; start < this.n; start++) {
      if (seen[start]) continue;
      seen[start] = 1;
      const queue = [start];
      for (let head = 0; head < queue.length; head++) {
        for (const w of this.adjacency[queue[head]]) {
          if (!seen[w]) {
            seen[w] = 1;
            queue.push(w);
          }
        }
      }
      out.push(queue.sort((a, b) => a - b));
    }
    return out;
  }

  /** Ring bonds are exactly the non-bridges (iterative Tarjan, no recursion). */
  private findRingBonds(): void {
    const tin = new Int32Array(this.n).fill(-1);
    const low = new Int32Array(this.n);
    let timer = 0;
    for (let root = 0; root < this.n; root++) {
      if (tin[root] !== -1) continue;
      tin[root] = low[root] = timer++;
      const stack: Array<[number, number, number]> = [[root, -1, 0]];
      while (stack.length > 0) {
        const top = stack[stack.length - 1];
        const [v, parent, index] = top;
        if (index < this.adjacency[v].length) {
          top[2] = index + 1;
          const w = this.adjacency[v][index];
          if (w === parent) continue;
          if (tin[w] !== -1) {
            // A non-tree edge always closes a cycle.
            low[v] = Math.min(low[v], tin[w]);
            this.ringBond.add(this.key(v, w));
          } else {
            tin[w] = low[w] = timer++;
            stack.push([w, v, 0]);
          }
          continue;
        }
        stack.pop();
        if (parent < 0) continue;
        low[parent] = Math.min(low[parent], low[v]);
        if (low[v] <= tin[parent]) this.ringBond.add(this.key(parent, v));
      }
    }
  }

  private ringNeighbors(atom: number): number[] {
    return this.adjacency[atom].filter((w) =>
      this.ringBond.has(this.key(atom, w)),
    );
  }

  /** Group ring bonds into ring systems and lay each out in local coords. */
  private layoutRingSystems(): void {
    for (let start = 0; start < this.n; start++) {
      if (this.system[start] !== -1) continue;
      if (this.ringNeighbors(start).length === 0) continue;
      const id = this.systemLayouts.length;
      const atoms = [start];
      this.system[start] = id;
      for (let head = 0; head < atoms.length; head++) {
        for (const w of this.ringNeighbors(atoms[head])) {
          if (this.system[w] === -1) {
            this.system[w] = id;
            atoms.push(w);
          }
        }
      }
      this.systemLayouts.push(this.layoutSystem(this.smallestRings(atoms)));
      this.systemPlaced.push(false);
    }
  }

  /** Smallest ring through each ring bond, deduplicated, smallest first. */
  private smallestRings(atoms: readonly number[]): number[][] {
    const rings = new Map<string, number[]>();
    for (const u of atoms) {
      for (const v of this.ringNeighbors(u)) {
        if (v < u) continue;
        const ring = this.shortestPath(u, v);
        if (!ring) continue;
        const id = [...ring].sort((a, b) => a - b).join(",");
        if (!rings.has(id)) rings.set(id, ring);
      }
    }
    return [...rings.values()].sort((a, b) => a.length - b.length);
  }

  /** Ring-bond path u → v that does not use the bond (u, v) itself. */
  private shortestPath(u: number, v: number): number[] | null {
    const parent = new Map<number, number>([[u, u]]);
    const queue = [u];
    for (let head = 0; head < queue.length; head++) {
      const a = queue[head];
      for (const w of this.ringNeighbors(a)) {
        if (a === u && w === v) continue;
        if (parent.has(w)) continue;
        parent.set(w, a);
        if (w === v) {
          const path = [v];
          let cursor = v;
          while (cursor !== u) {
            cursor = parent.get(cursor) as number;
            path.push(cursor);
          }
          return path.reverse();
        }
        queue.push(w);
      }
    }
    return null;
  }

  /** Place rings one by one, each next to the rings already placed. */
  private layoutSystem(rings: number[][]): Map<number, Point> {
    const local = new Map<number, Point>();
    if (rings.length === 0) return local;
    const pending = [...rings];
    // Seed with the ring sharing atoms with the most others (the fusion core).
    let seed = 0;
    let best = -1;
    pending.forEach((ring, index) => {
      const shared = pending.filter(
        (other) => other !== ring && other.some((a) => ring.includes(a)),
      ).length;
      if (shared > best) {
        best = shared;
        seed = index;
      }
    });
    const [first] = pending.splice(seed, 1);
    const radius = this.length / (2 * Math.sin(Math.PI / first.length));
    first.forEach((atom, k) => {
      const angle =
        -Math.PI / 2 +
        Math.PI / first.length +
        (2 * Math.PI * k) / first.length;
      local.set(atom, {
        x: radius * Math.cos(angle),
        y: radius * Math.sin(angle),
      });
    });
    while (pending.length > 0) {
      let pick = -1;
      let pickCount = 0;
      pending.forEach((ring, index) => {
        const count = ring.filter((a) => local.has(a)).length;
        if (count > pickCount) {
          pickCount = count;
          pick = index;
        }
      });
      if (pick < 0) {
        // Disconnected ring sets cannot happen inside one ring system.
        break;
      }
      const [ring] = pending.splice(pick, 1);
      if (pickCount === ring.length) continue;
      if (pickCount === 1) this.placeSpiro(ring, local);
      else this.placeFused(ring, local);
    }
    return local;
  }

  /**
   * Hang a ring off one placed atom, its centre straight out along the
   * bisector of the ring bonds the shared atom already has. Of the two mirror
   * images, the one whose onward bonds (to atoms outside this ring) point
   * away from the placed atoms is kept, so the rings fused on next do not
   * fold back onto the ones already down.
   */
  private placeSpiro(ring: number[], local: Map<number, Point>): void {
    const shared = ring.find((a) => local.has(a)) as number;
    const s = local.get(shared) as Point;
    const held = this.ringNeighbors(shared)
      .map((w) => local.get(w))
      .filter((p): p is Point => p !== undefined);
    const away = unit(sub(s, centroid(held)), { x: 1, y: 0 });
    const radius = this.length / (2 * Math.sin(Math.PI / ring.length));
    const center = { x: s.x + away.x * radius, y: s.y + away.y * radius };
    const start = ring.indexOf(shared);
    const base = Math.atan2(s.y - center.y, s.x - center.x);
    const placed = [...local.values()];
    const members = new Set(ring);
    const candidates = [1, -1].map((direction) => {
      const points = new Map<number, Point>();
      const onward: Point[] = [];
      for (let k = 1; k < ring.length; k++) {
        const atom = ring[(start + k) % ring.length];
        const angle = base + (direction * 2 * Math.PI * k) / ring.length;
        const p = {
          x: center.x + radius * Math.cos(angle),
          y: center.y + radius * Math.sin(angle),
        };
        points.set(atom, p);
        const out = unit(sub(p, center), away);
        for (const w of this.adjacency[atom]) {
          if (members.has(w) || local.has(w)) continue;
          onward.push({
            x: p.x + out.x * this.length,
            y: p.y + out.y * this.length,
          });
        }
      }
      return { points, crowd: crowding(onward, placed, this.length) };
    });
    const chosen =
      candidates[1].crowd < candidates[0].crowd ? candidates[1] : candidates[0];
    for (const [atom, p] of chosen.points) local.set(atom, p);
  }

  /**
   * Close every gap of unplaced atoms on an arc between its placed ends. The
   * arc bulges to whichever side of the chord crowds the placed atoms less;
   * on a tie, away from the ring bonds its ends already have.
   */
  private placeFused(ring: number[], local: Map<number, Point>): void {
    const size = ring.length;
    const startIndex = ring.findIndex(
      (a, k) => local.has(a) && !local.has(ring[(k + 1) % size]),
    );
    if (startIndex < 0) return;
    let k = startIndex;
    for (let guard = 0; guard < size; guard++) {
      const a = ring[k % size];
      if (local.has(a) && !local.has(ring[(k + 1) % size])) {
        const gap: number[] = [];
        let j = k + 1;
        while (!local.has(ring[j % size])) {
          gap.push(ring[j % size]);
          j++;
        }
        const b = ring[j % size];
        const points = this.closeGap(a, b, gap.length, local);
        gap.forEach((atom, index) => {
          local.set(atom, points[index]);
        });
        k = j;
      } else {
        k++;
      }
    }
  }

  private closeGap(
    a: number,
    b: number,
    count: number,
    local: Map<number, Point>,
  ): Point[] {
    const pa = local.get(a) as Point;
    const pb = local.get(b) as Point;
    const held = [a, b].flatMap((end) =>
      this.ringNeighbors(end)
        .filter((w) => w !== a && w !== b)
        .map((w) => local.get(w))
        .filter((p): p is Point => p !== undefined),
    );
    const along = { x: pb.x - pa.x, y: pb.y - pa.y };
    const inside = sub(
      centroid(held.length > 0 ? held : [...local.values()]),
      pa,
    );
    const preferred: 1 | -1 =
      along.x * inside.y - along.y * inside.x > 0 ? -1 : 1;
    const [first, second] = [preferred, -preferred as 1 | -1].map((side) =>
      arcBetween(pa, pb, count, this.length, side),
    );
    const others = [...local.entries()]
      .filter(([atom]) => atom !== a && atom !== b)
      .map(([, p]) => p);
    return crowding(second, others, this.length) <
      crowding(first, others, this.length)
      ? second
      : first;
  }

  private layoutComponent(component: number[]): void {
    const queue: number[] = [];
    const seedSystem = this.largestSystem(component);
    if (seedSystem >= 0) {
      for (const [atom, p] of this.systemLayouts[seedSystem]) {
        this.setPos(atom, { x: p.x, y: p.y });
        queue.push(atom);
      }
      this.systemPlaced[seedSystem] = true;
    } else {
      const seed = this.chainEnd(component);
      this.setPos(seed, { x: 0, y: 0 });
      queue.push(seed);
    }
    for (let head = 0; head < queue.length; head++) {
      const a = queue[head];
      const unplaced = this.adjacency[a].filter((w) => this.pos[w] === null);
      if (unplaced.length === 0) continue;
      // Ring systems first, so chains bend around them rather than into them.
      unplaced.sort(
        (p, q) => Number(this.system[q] >= 0) - Number(this.system[p] >= 0),
      );
      const directions = this.chooseDirections(a, unplaced);
      unplaced.forEach((w, index) => {
        if (this.pos[w] !== null) return;
        const dir = directions[index];
        const origin = this.pos[a] as Point;
        const target = {
          x: origin.x + Math.cos(dir.angle) * this.length,
          y: origin.y + Math.sin(dir.angle) * this.length,
        };
        const sys = this.system[w];
        if (sys >= 0 && !this.systemPlaced[sys]) {
          for (const atom of this.placeSystem(sys, w, target, origin)) {
            queue.push(atom);
          }
          return;
        }
        this.setPos(w, target);
        this.turn[w] = dir.turn;
        queue.push(w);
      });
    }
  }

  private setPos(atom: number, p: Point): void {
    this.pos[atom] = p;
    this.placedList.push(atom);
  }

  private largestSystem(component: readonly number[]): number {
    const sizes = new Map<number, number>();
    for (const atom of component) {
      const sys = this.system[atom];
      if (sys >= 0) sizes.set(sys, (sizes.get(sys) ?? 0) + 1);
    }
    let best = -1;
    let bestSize = 0;
    for (const [sys, size] of sizes) {
      if (size > bestSize) {
        best = sys;
        bestSize = size;
      }
    }
    return best;
  }

  /** One end of the longest shortest path (two BFS sweeps). */
  private chainEnd(component: readonly number[]): number {
    const farthest = (from: number): number => {
      const dist = new Map<number, number>([[from, 0]]);
      const queue = [from];
      let last = from;
      for (let head = 0; head < queue.length; head++) {
        last = queue[head];
        for (const w of this.adjacency[last]) {
          if (!dist.has(w)) {
            dist.set(w, (dist.get(last) ?? 0) + 1);
            queue.push(w);
          }
        }
      }
      return last;
    };
    return farthest(farthest(component[0]));
  }

  /** Bond directions (radians) for the unplaced neighbors of `a`. */
  private chooseDirections(
    a: number,
    unplaced: readonly number[],
  ): Array<{ angle: number; turn: number }> {
    const origin = this.pos[a] as Point;
    const placedAngles = this.adjacency[a]
      .filter((w) => this.pos[w] !== null)
      .map((w) => {
        const p = this.pos[w] as Point;
        return Math.atan2(p.y - origin.y, p.x - origin.x);
      });
    const k = unplaced.length;
    if (placedAngles.length === 0) {
      return Array.from({ length: k }, (_, i) => ({
        angle: -Math.PI / 6 + (2 * Math.PI * i) / k,
        turn: i % 2 === 0 ? 1 : -1,
      }));
    }
    if (placedAngles.length === 1) {
      const back = placedAngles[0];
      if (k === 1) {
        if (this.isLinear(a)) return [{ angle: back + Math.PI, turn: 1 }];
        const sign = this.turn[a];
        const preferred = back + (sign * 2 * Math.PI) / 3;
        const other = back - (sign * 2 * Math.PI) / 3;
        if (this.clashes(a, preferred) && !this.clashes(a, other)) {
          return [{ angle: other, turn: sign }];
        }
        return [{ angle: preferred, turn: -sign }];
      }
      if (k === 2) {
        return [
          { angle: back + (2 * Math.PI) / 3, turn: -1 },
          { angle: back - (2 * Math.PI) / 3, turn: 1 },
        ];
      }
      return Array.from({ length: k }, (_, i) => ({
        angle: back + (2 * Math.PI * (i + 1)) / (k + 1),
        turn: 1,
      }));
    }
    // Several placed neighbors (a ring atom): split the widest free angle.
    const sorted = [...placedAngles].sort((p, q) => p - q);
    let gapStart = sorted[sorted.length - 1];
    let gap = sorted[0] + 2 * Math.PI - gapStart;
    for (let i = 1; i < sorted.length; i++) {
      const g = sorted[i] - sorted[i - 1];
      if (g > gap) {
        gap = g;
        gapStart = sorted[i - 1];
      }
    }
    return Array.from({ length: k }, (_, i) => ({
      angle: gapStart + (gap * (i + 1)) / (k + 1),
      turn: 1,
    }));
  }

  /** `sp` centre: a triple bond, or two cumulated double bonds. */
  private isLinear(a: number): boolean {
    const orders = this.adjacency[a].map((w) => this.order(a, w));
    if (orders.some((o) => o === 3)) return true;
    return orders.length === 2 && orders.every((o) => o === 2);
  }

  private clashes(a: number, angle: number): boolean {
    const origin = this.pos[a] as Point;
    const p = {
      x: origin.x + Math.cos(angle) * this.length,
      y: origin.y + Math.sin(angle) * this.length,
    };
    return this.countClashes([p], new Set([a])) > 0;
  }

  private countClashes(points: readonly Point[], ignore: Set<number>): number {
    const limit = CLASH_DISTANCE * this.length;
    let count = 0;
    for (const atom of this.placedList) {
      if (ignore.has(atom)) continue;
      const q = this.pos[atom] as Point;
      for (const p of points) {
        if (Math.hypot(p.x - q.x, p.y - q.y) < limit) count++;
      }
    }
    return count;
  }

  /**
   * Put ring system `sys` down rigidly so its atom `root` sits at `target`
   * with the ring's outward direction at `root` pointing back at `from`.
   * Of the two mirror images, the one with fewer clashes is kept.
   */
  private placeSystem(
    sys: number,
    root: number,
    target: Point,
    from: Point,
  ): number[] {
    const local = this.systemLayouts[sys];
    const r = local.get(root) as Point;
    const inner = this.ringNeighbors(root)
      .map((w) => local.get(w))
      .filter((p): p is Point => p !== undefined);
    const outward = unit(sub(r, centroid(inner)), { x: 1, y: 0 });
    const want = unit(sub(from, target), { x: -1, y: 0 });
    const candidates = [1, -1].map((mirror) => {
      // Mirror across the outward axis, then rotate outward onto `want`.
      const out = { x: outward.x, y: outward.y * mirror };
      const rot = Math.atan2(want.y, want.x) - Math.atan2(out.y, out.x);
      const cos = Math.cos(rot);
      const sin = Math.sin(rot);
      const placed = new Map<number, Point>();
      for (const [atom, p] of local) {
        const dx = p.x - r.x;
        const dy = (p.y - r.y) * mirror;
        placed.set(atom, {
          x: target.x + dx * cos - dy * sin,
          y: target.y + dx * sin + dy * cos,
        });
      }
      return placed;
    });
    const scores = candidates.map((placed) =>
      this.countClashes([...placed.values()], new Set()),
    );
    const chosen = scores[1] < scores[0] ? candidates[1] : candidates[0];
    this.systemPlaced[sys] = true;
    const atoms: number[] = [];
    for (const [atom, p] of chosen) {
      if (this.pos[atom] !== null) continue;
      this.setPos(atom, p);
      atoms.push(atom);
    }
    return atoms;
  }
}

/** How much `points` crowd `others`: summed squared shortfall below one bond. */
function crowding(
  points: readonly Point[],
  others: readonly Point[],
  length: number,
): number {
  let total = 0;
  for (const p of points) {
    for (const q of others) {
      const short = length - Math.hypot(p.x - q.x, p.y - q.y);
      if (short > 0) total += short * short;
    }
  }
  return total;
}
