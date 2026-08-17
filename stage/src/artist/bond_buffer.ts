import { Vector3 } from "@babylonjs/core";
import type { Block } from "@molcrafts/molvis-core/molrs";
import { encodePickingColorInto } from "../picker";
import { resolveBondOrders } from "../utils/bond_order";
import { type AtomCoords, BondPlaneFrame } from "./bond_plane";
import type { BondColorMode, BondOrderMode } from "./representation";

/** Stick count for ORDER_CONFIG keys; input is already 1|2|3 from displayBondOrder. */
function stickConfigKey(sticks: number): 1 | 2 | 3 {
  return sticks >= 3 ? 3 : sticks >= 2 ? 2 : 1;
}

// Module-level scratch vectors — avoids per-call allocation in hot paths.
const TMP_P1 = new Vector3();
const TMP_P2 = new Vector3();
const TMP_CENTER = new Vector3();
const TMP_DIR = new Vector3();
const TMP_PERP1 = new Vector3();
const TMP_PERP2 = new Vector3();
const TMP_PLANE = new Vector3();

export interface BondBufferOptions {
  radius?: number;
  visible?: (i: number) => boolean;
  visibleBond?: (bondIndex: number, atomI: number, atomJ: number) => boolean;
  orderMode?: BondOrderMode;
  colorMode?: BondColorMode;
  bondColor?: readonly [number, number, number, number];
  /**
   * Precomputed minimum-image displacement vectors `(atom_j - atom_i)`
   * laid out row-major `[dx0, dy0, dz0, dx1, dy1, dz1, …]`, one triple
   * per logical bond. When provided, the renderer derives the far
   * endpoint as `atom_i + displacement[b]` instead of reading atom j's
   * raw position — draw-time MI only (not a full-frame wrap; atom
   * columns stay post-policy). Callers generate this via
   * `Box.delta(a, b, true)` so per-axis PBC flags and triclinic cells
   * are honored natively by WASM.
   */
  miDisplacements?: Float64Array;
}

export interface BondBufferResult {
  buffers: Map<string, Float32Array>;
  /** Total render instances (>= logical bond count when multi-bond orders exist) */
  instanceCount: number;
  /** Maps render instance index → logical bond index for picking */
  instanceMap: Uint32Array;
}

// Every stroke in a multiple bond carries the same visual weight as a single
// bond. Bond order is expressed only through a compact symmetric offset.
const ORDER_CONFIG: Record<
  number,
  { radiusScale: number; offsets: number[][] }
> = {
  1: { radiusScale: 1.0, offsets: [[0, 0]] },
  2: {
    radiusScale: 1.0,
    offsets: [
      [1, 0],
      [-1, 0],
    ],
  },
  3: {
    radiusScale: 1.0,
    offsets: [
      [0, 0],
      [2, 0],
      [-2, 0],
    ], // coplanar: center + two sides
  },
};

// Fixed center-line offset in world units. Do not multiply by bond order: that
// makes triple bonds fan outward and read as three unrelated connections.
const MULTI_BOND_SPACING = 0.09;

/**
 * Complete the perpendicular frame (perp1, perp2) around a bond direction from
 * the offset axis {@link BondPlaneAxis} resolved. perp1 and perp2 are
 * orthogonal to dir and to each other.
 */
function completePerpFrame(dir: Vector3, offsetAxis: Vector3): void {
  TMP_PERP1.copyFrom(offsetAxis);
  Vector3.CrossToRef(dir, TMP_PERP1, TMP_PERP2);
  TMP_PERP2.normalize();
}

/**
 * Number of render instances a stick-count expands to (1, 2, or 3).
 * `sticks` is the output of {@link displayBondOrder} / {@link resolveBondOrders}
 * — never a float chemistry value.
 */
export function subBondCount(sticks: number): number {
  return ORDER_CONFIG[stickConfigKey(sticks)].offsets.length;
}

/**
 * Build the per-instance GPU buffers for a single bond with the given stick
 * count (1–3 from {@link displayBondOrder}). Returns a map of
 * stride-sized-by-subCount buffers ready to hand to `ImpostorState.append`,
 * matching the layout emitted by `buildBondBuffers` so edit-mode bonds and
 * frame-mode bonds render identically.
 *
 * Color0/color1 are the endpoint atom colors (length-4 RGBA Float32Array).
 * splitOffset is the same per-instance split value used in single-bond draws.
 *
 * `offsetAxis` is required for multiple bonds and must come from
 * {@link BondPlaneAxis} — `SceneIndex.bondPlaneAxis` resolves it from the live
 * edit graph, so an edit-pool bond lands in the same plane the frame draw would
 * have put it in.
 */
export function buildSubBondInstanceBuffers(
  start: Vector3,
  end: Vector3,
  sticks: number,
  baseRadius: number,
  color0: Float32Array,
  color1: Float32Array,
  splitOffset: number,
  offsetAxis: Vector3,
): { buffers: Map<string, Float32Array>; subCount: number } {
  const configKey = stickConfigKey(sticks);
  const config = ORDER_CONFIG[configKey];
  const subCount = config.offsets.length;

  TMP_P1.copyFrom(start);
  TMP_P2.copyFrom(end);
  TMP_CENTER.copyFrom(TMP_P1).addInPlace(TMP_P2).scaleInPlace(0.5);
  TMP_DIR.copyFrom(TMP_P2).subtractInPlace(TMP_P1);
  const distance = TMP_DIR.length();
  if (distance > 1e-8) TMP_DIR.scaleInPlace(1 / distance);
  else TMP_DIR.set(0, 1, 0);

  if (configKey > 1) completePerpFrame(TMP_DIR, offsetAxis);

  const subRadius = baseRadius * config.radiusScale;
  const scale = distance + subRadius * 2;
  const offsetDist = MULTI_BOND_SPACING;

  const matrix = new Float32Array(16 * subCount);
  const data0 = new Float32Array(4 * subCount);
  const data1 = new Float32Array(4 * subCount);
  const col0 = new Float32Array(4 * subCount);
  const col1 = new Float32Array(4 * subCount);
  const split = new Float32Array(4 * subCount);

  for (let s = 0; s < subCount; s++) {
    const [ox, oy] = config.offsets[s];
    let cx = TMP_CENTER.x;
    let cy = TMP_CENTER.y;
    let cz = TMP_CENTER.z;
    if (configKey > 1) {
      cx += (TMP_PERP1.x * ox + TMP_PERP2.x * oy) * offsetDist;
      cy += (TMP_PERP1.y * ox + TMP_PERP2.y * oy) * offsetDist;
      cz += (TMP_PERP1.z * ox + TMP_PERP2.z * oy) * offsetDist;
    }

    const mOff = s * 16;
    const idx4 = s * 4;
    matrix[mOff + 0] = scale;
    matrix[mOff + 5] = scale;
    matrix[mOff + 10] = scale;
    matrix[mOff + 15] = 1;
    matrix[mOff + 12] = cx;
    matrix[mOff + 13] = cy;
    matrix[mOff + 14] = cz;

    data0[idx4 + 0] = cx;
    data0[idx4 + 1] = cy;
    data0[idx4 + 2] = cz;
    data0[idx4 + 3] = subRadius;

    data1[idx4 + 0] = TMP_DIR.x;
    data1[idx4 + 1] = TMP_DIR.y;
    data1[idx4 + 2] = TMP_DIR.z;
    data1[idx4 + 3] = distance;

    col0.set(color0, idx4);
    col1.set(color1, idx4);
    split[idx4] = splitOffset;
  }

  const buffers = new Map<string, Float32Array>();
  buffers.set("matrix", matrix);
  buffers.set("instanceData0", data0);
  buffers.set("instanceData1", data1);
  buffers.set("instanceColor0", col0);
  buffers.set("instanceColor1", col1);
  buffers.set("instanceSplit", split);
  return { buffers, subCount };
}

/**
 * Count total render instances needed for all bonds.
 */
export function countBondInstances(
  bondsBlock: Block,
  orderMode: BondOrderMode = "multiple",
): number {
  if (orderMode === "single") return bondsBlock.nrows();
  const orderCol = resolveBondOrders(bondsBlock);
  if (!orderCol) return bondsBlock.nrows();
  let total = 0;
  for (let b = 0; b < bondsBlock.nrows(); b++) {
    total += subBondCount(orderCol[b]);
  }
  return total;
}

/**
 * Build GPU buffers for all bonds in a frame block.
 * Emits multiple equal-weight instances per bond when order > 1.
 */
export function buildBondBuffers(
  bondsBlock: Block,
  atomsBlock: Block,
  atomColor: Float32Array,
  bondMeshUniqueId: number,
  options?: BondBufferOptions,
): BondBufferResult | undefined {
  if (!bondsBlock || bondsBlock.nrows() === 0) return undefined;

  const logicalCount = bondsBlock.nrows();
  const iAtoms = bondsBlock.viewColU32("atomi");
  const jAtoms = bondsBlock.viewColU32("atomj");
  if (!iAtoms || !jAtoms) return undefined;

  const xCoords = atomsBlock.viewColF("x");
  const yCoords = atomsBlock.viewColF("y");
  const zCoords = atomsBlock.viewColF("z");
  if (!xCoords || !yCoords || !zCoords) return undefined;

  const orderCol = resolveBondOrders(bondsBlock);

  // Size buffers exactly. Without an order column every bond is one instance;
  // with one, countBondInstances() sums the per-bond instance counts in a
  // single cheap pass. This avoids the old 3x over-allocation (upper bound for
  // all-triple bonds) plus the slice() trim afterwards — wasteful for the
  // overwhelmingly common all-single-order case.
  const orderMode = options?.orderMode ?? "multiple";
  const maxInstances = orderCol
    ? countBondInstances(bondsBlock, orderMode)
    : logicalCount;

  // Only multiple bonds need a plane to be offset in, and `maxInstances`
  // already tells us whether any exist — so the neighbor topology is built
  // only when it will actually be read.
  const coords: AtomCoords = { x: xCoords, y: yCoords, z: zCoords };
  const planeFrame =
    maxInstances > logicalCount
      ? BondPlaneFrame.build(iAtoms, jAtoms, atomsBlock.nrows())
      : undefined;

  const bondMatrix = new Float32Array(maxInstances * 16);
  const bondData0 = new Float32Array(maxInstances * 4);
  const bondData1 = new Float32Array(maxInstances * 4);
  const bondCol0 = new Float32Array(maxInstances * 4);
  const bondCol1 = new Float32Array(maxInstances * 4);
  const bondSplit = new Float32Array(maxInstances * 4);
  const bondPick = new Float32Array(maxInstances * 4);
  const instanceMap = new Uint32Array(maxInstances);

  const baseBondRadius = options?.radius ?? 0.1;
  const isVisible = options?.visible ?? (() => true);
  const isBondVisible = options?.visibleBond ?? (() => true);
  const miDisp = options?.miDisplacements;
  const colorMode = options?.colorMode ?? "split";
  const bondColor = options?.bondColor ?? ([0.7, 0.7, 0.7, 1] as const);

  let renderIdx = 0;

  for (let b = 0; b < logicalCount; b++) {
    const i = iAtoms[b];
    const j = jAtoms[b];
    const atomsVisible = isVisible(i) && isVisible(j);
    const bondVisible = isBondVisible(b, i, j);
    const sticks =
      orderMode === "multiple" && orderCol ? stickConfigKey(orderCol[b]) : 1;
    const config = ORDER_CONFIG[sticks];

    TMP_P1.set(xCoords[i], yCoords[i], zCoords[i]);
    if (miDisp) {
      const o = 3 * b;
      TMP_P2.set(
        TMP_P1.x + miDisp[o],
        TMP_P1.y + miDisp[o + 1],
        TMP_P1.z + miDisp[o + 2],
      );
    } else {
      TMP_P2.set(xCoords[j], yCoords[j], zCoords[j]);
    }

    TMP_CENTER.copyFrom(TMP_P1).addInPlace(TMP_P2).scaleInPlace(0.5);
    TMP_DIR.copyFrom(TMP_P2).subtractInPlace(TMP_P1);
    const dist = TMP_DIR.length();
    if (dist > 1e-8) TMP_DIR.scaleInPlace(1 / dist);
    else TMP_DIR.set(0, 1, 0);

    // Compute perpendicular frame for multi-bond offset
    if (sticks > 1 && planeFrame) {
      planeFrame.perpendicular(i, j, TMP_DIR, coords, TMP_PLANE);
      completePerpFrame(TMP_DIR, TMP_PLANE);
    }

    const subRadius = baseBondRadius * config.radiusScale;
    const alpha = bondVisible ? (atomsVisible ? 1.0 : 0.2) : 0.0;
    const iOff = i * 4;
    const jOff = j * 4;

    for (const [ox, oy] of config.offsets) {
      // Compute offset position for this sub-bond
      let cx = TMP_CENTER.x;
      let cy = TMP_CENTER.y;
      let cz = TMP_CENTER.z;

      if (sticks > 1) {
        const offsetDist = MULTI_BOND_SPACING;
        cx += (TMP_PERP1.x * ox + TMP_PERP2.x * oy) * offsetDist;
        cy += (TMP_PERP1.y * ox + TMP_PERP2.y * oy) * offsetDist;
        cz += (TMP_PERP1.z * ox + TMP_PERP2.z * oy) * offsetDist;
      }

      const scale = dist + subRadius * 2;
      const matOffset = renderIdx * 16;
      const idx4 = renderIdx * 4;

      // Matrix
      bondMatrix[matOffset + 0] = scale;
      bondMatrix[matOffset + 5] = scale;
      bondMatrix[matOffset + 10] = scale;
      bondMatrix[matOffset + 15] = 1;
      bondMatrix[matOffset + 12] = cx;
      bondMatrix[matOffset + 13] = cy;
      bondMatrix[matOffset + 14] = cz;

      // Data0 (center, radius)
      bondData0[idx4 + 0] = cx;
      bondData0[idx4 + 1] = cy;
      bondData0[idx4 + 2] = cz;
      bondData0[idx4 + 3] = subRadius;

      // Data1 (direction, length)
      bondData1[idx4 + 0] = TMP_DIR.x;
      bondData1[idx4 + 1] = TMP_DIR.y;
      bondData1[idx4 + 2] = TMP_DIR.z;
      bondData1[idx4 + 3] = dist;

      // Split
      bondSplit[idx4 + 0] = 0;

      // Colors
      if (colorMode === "theme") {
        bondCol0[idx4 + 0] = bondColor[0];
        bondCol0[idx4 + 1] = bondColor[1];
        bondCol0[idx4 + 2] = bondColor[2];
        bondCol0[idx4 + 3] = bondColor[3] * alpha;
        bondCol1.set(bondCol0.subarray(idx4, idx4 + 4), idx4);
      } else {
        bondCol0[idx4 + 0] = atomColor[iOff + 0];
        bondCol0[idx4 + 1] = atomColor[iOff + 1];
        bondCol0[idx4 + 2] = atomColor[iOff + 2];
        bondCol0[idx4 + 3] = atomColor[iOff + 3] * alpha;

        bondCol1[idx4 + 0] = atomColor[jOff + 0];
        bondCol1[idx4 + 1] = atomColor[jOff + 1];
        bondCol1[idx4 + 2] = atomColor[jOff + 2];
        bondCol1[idx4 + 3] = atomColor[jOff + 3] * alpha;
      }

      // Picking — zero-allocation, all sub-instances share logical bond index
      encodePickingColorInto(bondMeshUniqueId, b, bondPick, idx4);

      instanceMap[renderIdx] = b;
      renderIdx++;
    }
  }

  // Trim to actual size if we over-allocated
  const totalInstances = renderIdx;
  const trim = <T extends Float32Array | Uint32Array>(
    arr: T,
    stride: number,
  ): T =>
    arr.length === totalInstances * stride
      ? arr
      : (arr.slice(0, totalInstances * stride) as T);

  const buffers = new Map<string, Float32Array>();
  buffers.set("matrix", trim(bondMatrix, 16));
  buffers.set("instanceData0", trim(bondData0, 4));
  buffers.set("instanceData1", trim(bondData1, 4));
  buffers.set("instanceColor0", trim(bondCol0, 4));
  buffers.set("instanceColor1", trim(bondCol1, 4));
  buffers.set("instanceSplit", trim(bondSplit, 4));
  buffers.set("instancePickingColor", trim(bondPick, 4));

  return {
    buffers,
    instanceCount: totalInstances,
    instanceMap: trim(instanceMap, 1),
  };
}

/**
 * In-place refresh of bond positions from updated atom coordinates.
 * Handles multi-instance bonds via order column.
 */
export function refreshBondPositions(
  bondsBlock: Block,
  x: Float64Array,
  y: Float64Array,
  z: Float64Array,
  bondState: {
    /** Edit-pool instance count (excludes frame segment). */
    count: number;
    /** Frame-segment instance count. Total = frameOffset + count. */
    frameOffset: number;
    uploadBuffer(name: string): void;
    buffers: Map<string, { data: Float32Array }>;
  },
  miDisplacements?: Float64Array,
  orderMode: BondOrderMode = "multiple",
): void {
  const iAtoms = bondsBlock.viewColU32("atomi");
  const jAtoms = bondsBlock.viewColU32("atomj");
  const orderCol = resolveBondOrders(bondsBlock);
  if (!iAtoms || !jAtoms) return;

  const logicalCount = bondsBlock.nrows();
  const matB = bondState.buffers.get("matrix");
  const d0B = bondState.buffers.get("instanceData0");
  const d1B = bondState.buffers.get("instanceData1");

  if (!matB || !d0B || !d1B) return;

  // Frame bonds live in [0..frameOffset); edit bonds after that. Using only
  // `count` (edit pool) skips every trajectory / committed-frame bond — that
  // was why position-only pipeline updates left sticks frozen while atoms moved.
  const totalInstances = bondState.frameOffset + bondState.count;
  if (totalInstances <= 0) return;

  // Same molecular plane the initial draw used. Deriving it from geometry on
  // both paths is what keeps a double bond still while a trajectory plays —
  // a camera-derived or axis-derived frame differs between the two and the
  // strokes visibly swing around the bond axis on every frame advance.
  const coords: AtomCoords = { x, y, z };
  const planeFrame =
    orderMode === "multiple" && orderCol?.some((sticks) => sticks > 1)
      ? BondPlaneFrame.build(iAtoms, jAtoms, x.length)
      : undefined;

  let renderIdx = 0;

  for (let b = 0; b < logicalCount; b++) {
    if (renderIdx >= totalInstances) break;

    const i = iAtoms[b];
    const j = jAtoms[b];
    const sticks =
      orderMode === "multiple" && orderCol ? stickConfigKey(orderCol[b]) : 1;
    const config = ORDER_CONFIG[sticks];

    TMP_P1.set(x[i], y[i], z[i]);
    if (miDisplacements) {
      const o = 3 * b;
      TMP_P2.set(
        TMP_P1.x + miDisplacements[o],
        TMP_P1.y + miDisplacements[o + 1],
        TMP_P1.z + miDisplacements[o + 2],
      );
    } else {
      TMP_P2.set(x[j], y[j], z[j]);
    }

    TMP_CENTER.copyFrom(TMP_P1).addInPlace(TMP_P2).scaleInPlace(0.5);
    TMP_DIR.copyFrom(TMP_P2).subtractInPlace(TMP_P1);
    const dist = TMP_DIR.length();
    if (dist > 1e-8) TMP_DIR.scaleInPlace(1 / dist);
    else TMP_DIR.set(0, 1, 0);

    if (sticks > 1 && planeFrame) {
      planeFrame.perpendicular(i, j, TMP_DIR, coords, TMP_PLANE);
      completePerpFrame(TMP_DIR, TMP_PLANE);
    }

    for (const [ox, oy] of config.offsets) {
      if (renderIdx >= totalInstances) break;

      let cx = TMP_CENTER.x;
      let cy = TMP_CENTER.y;
      let cz = TMP_CENTER.z;

      if (sticks > 1) {
        const offsetDist = MULTI_BOND_SPACING;
        cx += (TMP_PERP1.x * ox + TMP_PERP2.x * oy) * offsetDist;
        cy += (TMP_PERP1.y * ox + TMP_PERP2.y * oy) * offsetDist;
        cz += (TMP_PERP1.z * ox + TMP_PERP2.z * oy) * offsetDist;
      }

      const radius = d0B.data[renderIdx * 4 + 3];
      const scale = dist + radius * 2;

      matB.data[renderIdx * 16 + 0] = scale;
      matB.data[renderIdx * 16 + 5] = scale;
      matB.data[renderIdx * 16 + 10] = scale;
      matB.data[renderIdx * 16 + 12] = cx;
      matB.data[renderIdx * 16 + 13] = cy;
      matB.data[renderIdx * 16 + 14] = cz;

      d0B.data[renderIdx * 4 + 0] = cx;
      d0B.data[renderIdx * 4 + 1] = cy;
      d0B.data[renderIdx * 4 + 2] = cz;

      d1B.data[renderIdx * 4 + 0] = TMP_DIR.x;
      d1B.data[renderIdx * 4 + 1] = TMP_DIR.y;
      d1B.data[renderIdx * 4 + 2] = TMP_DIR.z;
      d1B.data[renderIdx * 4 + 3] = dist;

      renderIdx++;
    }
  }

  bondState.uploadBuffer("matrix");
  bondState.uploadBuffer("instanceData0");
  bondState.uploadBuffer("instanceData1");
}
