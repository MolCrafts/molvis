import type { Vector3 } from "@babylonjs/core";

/** Atom coordinate columns, as handed out by `Block.viewColF`. */
export interface AtomCoords {
  readonly x: ArrayLike<number>;
  readonly y: ArrayLike<number>;
  readonly z: ArrayLike<number>;
}

/**
 * A neighbor farther than this (Å) does not describe the bond's local
 * geometry. The only way one shows up is a molecule split across a periodic
 * boundary, where the neighbor's raw coordinate sits a whole cell away.
 */
const MAX_REFERENCE_DISTANCE = 4.0;
const MAX_REFERENCE_DISTANCE_SQ = MAX_REFERENCE_DISTANCE ** 2;

/**
 * A neighbor whose component perpendicular to the bond is shorter than this
 * (Å) is collinear with it and spans no plane — the substituents of an alkyne
 * carbon, for instance.
 */
const MIN_PERPENDICULAR = 0.05;
const MIN_PERPENDICULAR_SQ = MIN_PERPENDICULAR ** 2;

/**
 * The one algorithm that decides where a multiple bond's strokes go.
 *
 * Strokes are offset perpendicular to the bond axis, and *which* perpendicular
 * is chosen decides the plane they span. Picking it from the camera makes an
 * aromatic ring's double bonds stand out of the ring plane the moment the ring
 * is not face-on, and — worse — makes the answer depend on when the buffers
 * happened to be built. This class answers from the molecule alone: the
 * perpendicular component of a neighbor bond, which holds the strokes coplanar
 * with the sp2 centre. For benzene that is flat inside the hexagon, from every
 * viewpoint and at every frame.
 *
 * Construct → {@link reset} with the bond axis → {@link offer} each neighbor →
 * {@link resolve} the axis. Callers enumerate neighbors however suits them —
 * {@link BondPlaneFrame} over frame blocks, `SceneIndex.bondPlaneAxis` over the
 * live edit graph — but the geometry lives only here.
 */
export class BondPlaneAxis {
  private dirX = 0;
  private dirY = 0;
  private dirZ = 1;
  private bestX = 0;
  private bestY = 0;
  private bestZ = 0;
  private bestSq = MIN_PERPENDICULAR_SQ;

  /** Begin resolving the axis for a bond pointing along `dir` (unit length). */
  public reset(dir: Vector3): void {
    this.dirX = dir.x;
    this.dirY = dir.y;
    this.dirZ = dir.z;
    this.bestX = 0;
    this.bestY = 0;
    this.bestZ = 0;
    this.bestSq = MIN_PERPENDICULAR_SQ;
  }

  /**
   * Offer a neighbor as a displacement measured from the endpoint it hangs
   * off. The most off-axis neighbor wins; ties keep the earliest offered, so
   * the answer is stable frame to frame.
   */
  public offer(rx: number, ry: number, rz: number): void {
    if (rx * rx + ry * ry + rz * rz > MAX_REFERENCE_DISTANCE_SQ) return;

    const along = rx * this.dirX + ry * this.dirY + rz * this.dirZ;
    const px = rx - along * this.dirX;
    const py = ry - along * this.dirY;
    const pz = rz - along * this.dirZ;
    const perpSq = px * px + py * py + pz * pz;
    if (perpSq <= this.bestSq) return;

    this.bestSq = perpSq;
    this.bestX = px;
    this.bestY = py;
    this.bestZ = pz;
  }

  /**
   * Write the unit offset axis into `out`. Always succeeds.
   *
   * With no neighbor spanning a plane — an isolated O=O, a linear C≡C — the
   * geometry is cylindrically symmetric and no perpendicular is more correct
   * than another, so a fixed reference axis decides. That keeps the answer a
   * function of the molecule and nothing else.
   */
  public resolve(out: Vector3): void {
    if (this.bestSq > MIN_PERPENDICULAR_SQ) {
      out.set(this.bestX, this.bestY, this.bestZ).normalize();
      return;
    }
    // Cross with ẑ, or with x̂ where the bond is too close to ẑ to cross.
    if (Math.abs(this.dirZ) > 0.9) out.set(0, this.dirZ, -this.dirY);
    else out.set(this.dirY, -this.dirX, 0);
    out.normalize();
  }
}

/**
 * Dense neighbor index over a frame's bonds block, feeding {@link BondPlaneAxis}
 * for every bond of a frame in one pass.
 *
 * Adjacency is stored CSR-style: `rowStart[a] … rowStart[a + 1]` indexes the
 * slice of `neighbors` belonging to atom `a`.
 */
export class BondPlaneFrame {
  private readonly axis = new BondPlaneAxis();

  private constructor(
    private readonly rowStart: Uint32Array,
    private readonly neighbors: Uint32Array,
  ) {}

  /** Build from a bonds block's endpoint columns. */
  public static build(
    atomi: ArrayLike<number>,
    atomj: ArrayLike<number>,
    atomCount: number,
  ): BondPlaneFrame {
    const bondCount = atomi.length;
    const rowStart = new Uint32Array(atomCount + 1);
    for (let b = 0; b < bondCount; b++) {
      const i = atomi[b];
      const j = atomj[b];
      if (i === j || i >= atomCount || j >= atomCount) continue;
      rowStart[i + 1]++;
      rowStart[j + 1]++;
    }
    for (let a = 0; a < atomCount; a++) rowStart[a + 1] += rowStart[a];

    const neighbors = new Uint32Array(rowStart[atomCount]);
    const cursor = rowStart.slice(0, atomCount);
    for (let b = 0; b < bondCount; b++) {
      const i = atomi[b];
      const j = atomj[b];
      if (i === j || i >= atomCount || j >= atomCount) continue;
      neighbors[cursor[i]++] = j;
      neighbors[cursor[j]++] = i;
    }
    return new BondPlaneFrame(rowStart, neighbors);
  }

  /**
   * Write into `out` the unit offset axis for bond `i–j`. `dir` must be
   * normalized. Neighbors of `i` are offered before neighbors of `j`.
   */
  public perpendicular(
    i: number,
    j: number,
    dir: Vector3,
    coords: AtomCoords,
    out: Vector3,
  ): void {
    this.axis.reset(dir);
    this.offerNeighbors(i, j, coords);
    this.offerNeighbors(j, i, coords);
    this.axis.resolve(out);
  }

  private offerNeighbors(
    anchor: number,
    partner: number,
    coords: AtomCoords,
  ): void {
    if (anchor >= this.rowStart.length - 1) return;

    const ax = coords.x[anchor];
    const ay = coords.y[anchor];
    const az = coords.z[anchor];
    for (let n = this.rowStart[anchor]; n < this.rowStart[anchor + 1]; n++) {
      const k = this.neighbors[n];
      if (k === partner || k === anchor) continue;
      this.axis.offer(coords.x[k] - ax, coords.y[k] - ay, coords.z[k] - az);
    }
  }
}
