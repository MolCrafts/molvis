import { Vector3 } from "@babylonjs/core";
import type { Block } from "@molcrafts/molrs";
import { encodePickingColorInto } from "../picker";
import { DType } from "../utils/dtype";

// Module-level scratch vectors — avoids per-call allocation in hot paths.
const TMP_P1 = new Vector3();
const TMP_P2 = new Vector3();
const TMP_CENTER = new Vector3();
const TMP_DIR = new Vector3();
const TMP_PERP1 = new Vector3();
const TMP_PERP2 = new Vector3();

const REF_UP = new Vector3(0, 0, 1);
const REF_ALT = new Vector3(1, 0, 0);

export interface BondBufferOptions {
  radius?: number;
  visible?: (i: number) => boolean;
  /**
   * Precomputed minimum-image displacement vectors `(atom_j - atom_i)`
   * laid out row-major `[dx0, dy0, dz0, dx1, dy1, dz1, …]`, one triple
   * per logical bond. When provided, the renderer derives the far
   * endpoint as `atom_i + displacement[b]` instead of reading atom j's
   * raw position — that's how PBC-wrapped atoms get bonds unwrapped to
   * their nearest image. Callers should generate this via
   * `Box.delta(a, b, true)` (with `minimum_image = true`) so per-axis
   * PBC flags and triclinic cell geometry are honored natively by
   * WASM.
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

// Sub-bond radius multipliers and offset factors per bond order
const ORDER_CONFIG: Record<
  number,
  { radiusScale: number; offsets: number[][] }
> = {
  1: { radiusScale: 1.0, offsets: [[0, 0]] },
  2: {
    radiusScale: 0.7,
    offsets: [
      [1, 0],
      [-1, 0],
    ],
  },
  3: {
    radiusScale: 0.4,
    offsets: [
      [0, 0],
      [1, 0],
      [-1, 0],
    ], // coplanar: center + two sides
  },
};

const MULTI_BOND_SPACING = 0.08; // base offset distance between sub-bonds

/**
 * Compute a perpendicular frame (perp1, perp2) for a bond direction.
 * perp1 and perp2 are orthogonal to dir and to each other.
 */
function computePerpFrame(dir: Vector3): void {
  // Cross with Z-up; if too parallel, use X
  const ref = Math.abs(Vector3.Dot(dir, REF_UP)) > 0.9 ? REF_ALT : REF_UP;
  Vector3.CrossToRef(dir, ref, TMP_PERP1);
  const len1 = TMP_PERP1.length();
  if (len1 > 1e-8) TMP_PERP1.scaleInPlace(1 / len1);
  Vector3.CrossToRef(dir, TMP_PERP1, TMP_PERP2);
  const len2 = TMP_PERP2.length();
  if (len2 > 1e-8) TMP_PERP2.scaleInPlace(1 / len2);
}

/**
 * Clamp a raw order value into the set of rendered orders (1..3).
 */
export function clampBondOrder(order: number): number {
  return Math.max(1, Math.min(Math.round(order), 3));
}

/**
 * Number of render instances an order-N bond expands to (1, 2, or 3).
 */
export function subBondCount(order: number): number {
  return ORDER_CONFIG[clampBondOrder(order)].offsets.length;
}

/**
 * Build the per-instance GPU buffers for a single bond with the given order.
 * Returns a map of stride-sized-by-subCount buffers ready to hand to
 * `ImpostorState.append`, matching the layout emitted by `buildBondBuffers`
 * so edit-mode bonds and frame-mode bonds render identically.
 *
 * Color0/color1 are the endpoint atom colors (length-4 RGBA Float32Array).
 * splitOffset is the same per-instance split value used in single-bond draws.
 */
export function buildSubBondInstanceBuffers(
  start: Vector3,
  end: Vector3,
  order: number,
  baseRadius: number,
  color0: Float32Array,
  color1: Float32Array,
  splitOffset: number,
): { buffers: Map<string, Float32Array>; subCount: number } {
  const clamped = clampBondOrder(order);
  const config = ORDER_CONFIG[clamped];
  const subCount = config.offsets.length;

  TMP_P1.copyFrom(start);
  TMP_P2.copyFrom(end);
  TMP_CENTER.copyFrom(TMP_P1).addInPlace(TMP_P2).scaleInPlace(0.5);
  TMP_DIR.copyFrom(TMP_P2).subtractInPlace(TMP_P1);
  const distance = TMP_DIR.length();
  if (distance > 1e-8) TMP_DIR.scaleInPlace(1 / distance);
  else TMP_DIR.set(0, 1, 0);

  if (clamped > 1) computePerpFrame(TMP_DIR);

  const subRadius = baseRadius * config.radiusScale;
  const scale = distance + subRadius * 2;
  const offsetDist = MULTI_BOND_SPACING * clamped;

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
    if (clamped > 1) {
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
export function countBondInstances(bondsBlock: Block): number {
  const orderCol =
    bondsBlock.dtype("order") === DType.U32
      ? bondsBlock.viewColU32("order")
      : undefined;
  if (!orderCol) return bondsBlock.nrows();
  let total = 0;
  for (let b = 0; b < bondsBlock.nrows(); b++) {
    total += Math.max(1, Math.min(orderCol[b], 3));
  }
  return total;
}

/**
 * Build GPU buffers for all bonds in a frame block.
 * Emits multiple thin instances per bond when order > 1.
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

  const orderCol =
    bondsBlock.dtype("order") === DType.U32
      ? bondsBlock.viewColU32("order")
      : undefined;

  // Pre-allocate with upper bound (3x for all-triple), trim unused at end
  const maxInstances = orderCol ? logicalCount * 3 : logicalCount;

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
  const miDisp = options?.miDisplacements;

  let renderIdx = 0;

  for (let b = 0; b < logicalCount; b++) {
    const i = iAtoms[b];
    const j = jAtoms[b];
    const visible = isVisible(i) && isVisible(j);
    const order = orderCol ? Math.max(1, Math.min(orderCol[b], 3)) : 1;
    const config = ORDER_CONFIG[order] ?? ORDER_CONFIG[1];

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
    if (order > 1) {
      computePerpFrame(TMP_DIR);
    }

    const subRadius = baseBondRadius * config.radiusScale;
    const alpha = visible ? 1.0 : 0.2;
    const iOff = i * 4;
    const jOff = j * 4;

    for (const [ox, oy] of config.offsets) {
      // Compute offset position for this sub-bond
      let cx = TMP_CENTER.x;
      let cy = TMP_CENTER.y;
      let cz = TMP_CENTER.z;

      if (order > 1) {
        const offsetDist = MULTI_BOND_SPACING * order;
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
      bondCol0[idx4 + 0] = atomColor[iOff + 0];
      bondCol0[idx4 + 1] = atomColor[iOff + 1];
      bondCol0[idx4 + 2] = atomColor[iOff + 2];
      bondCol0[idx4 + 3] = atomColor[iOff + 3] * alpha;

      bondCol1[idx4 + 0] = atomColor[jOff + 0];
      bondCol1[idx4 + 1] = atomColor[jOff + 1];
      bondCol1[idx4 + 2] = atomColor[jOff + 2];
      bondCol1[idx4 + 3] = atomColor[jOff + 3] * alpha;

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
    count: number;
    uploadBuffer(name: string): void;
    buffers: Map<string, { data: Float32Array }>;
  },
  miDisplacements?: Float64Array,
): void {
  const iAtoms = bondsBlock.viewColU32("atomi");
  const jAtoms = bondsBlock.viewColU32("atomj");
  const orderCol =
    bondsBlock.dtype("order") === DType.U32
      ? bondsBlock.viewColU32("order")
      : undefined;
  if (!iAtoms || !jAtoms) return;

  const logicalCount = bondsBlock.nrows();
  const matB = bondState.buffers.get("matrix");
  const d0B = bondState.buffers.get("instanceData0");
  const d1B = bondState.buffers.get("instanceData1");

  if (!matB || !d0B || !d1B) return;

  let renderIdx = 0;

  for (let b = 0; b < logicalCount; b++) {
    if (renderIdx >= bondState.count) break;

    const i = iAtoms[b];
    const j = jAtoms[b];
    const order = orderCol ? Math.max(1, Math.min(orderCol[b], 3)) : 1;
    const config = ORDER_CONFIG[order] ?? ORDER_CONFIG[1];

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

    if (order > 1) {
      computePerpFrame(TMP_DIR);
    }

    for (const [ox, oy] of config.offsets) {
      if (renderIdx >= bondState.count) break;

      let cx = TMP_CENTER.x;
      let cy = TMP_CENTER.y;
      let cz = TMP_CENTER.z;

      if (order > 1) {
        const offsetDist = MULTI_BOND_SPACING * order;
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
