import { toRowIndex } from "@molcrafts/molvis-core";
import type { Block } from "@molcrafts/molvis-core/molrs";
import { resolveBondOrders } from "../utils/bond_order";
import { BondPlaneFrame } from "./bond_plane";

/**
 * Everything about a bonds block that does not change while atoms move:
 * endpoint rows as plain `Uint32Array`s (no BigInt→Number per bond per
 * frame), the resolved stick counts, and the neighbour plane frame that keeps
 * multiple-bond strokes coplanar with the molecule.
 *
 * Derived once per molrs `Block` handle ({@link BondTopology.of} memoizes on
 * the handle) and carried by the Artist from a full build to the
 * position-only refreshes that follow it — `classifyFrameTransition` only
 * hands out `"position"` when the bond columns are element-wise identical,
 * so that carry-over is exact until the next full rebuild replaces it.
 */
export class BondTopology {
  private static readonly byBlock = new WeakMap<Block, BondTopology>();

  private planeFrame: BondPlaneFrame | undefined;
  private planeAtomCount = -1;
  private readonly multipleSticks: boolean;

  private constructor(
    /** Row index of atom i per bond. */
    readonly atomi: Uint32Array,
    /** Row index of atom j per bond. */
    readonly atomj: Uint32Array,
    /** Stick count per bond from `bond_type` / `bond_number`, or `null` when all single. */
    readonly orders: Float64Array | null,
  ) {
    this.multipleSticks = orders?.some((sticks) => sticks > 1) ?? false;
  }

  /** Topology for `block`, or `undefined` without canonical `atomi`/`atomj`. */
  static of(block: Block): BondTopology | undefined {
    const cached = BondTopology.byBlock.get(block);
    if (cached) return cached;
    if (
      !(block.has("atomi") && block.dtype("atomi") === "uint") ||
      !(block.has("atomj") && block.dtype("atomj") === "uint")
    )
      return undefined;
    const iCol = block.view("atomi") as BigUint64Array;
    const jCol = block.view("atomj") as BigUint64Array;
    const n = block.nRows;
    const atomi = new Uint32Array(n);
    const atomj = new Uint32Array(n);
    for (let b = 0; b < n; b++) {
      atomi[b] = toRowIndex(iCol[b]);
      atomj[b] = toRowIndex(jCol[b]);
    }
    const topology = new BondTopology(atomi, atomj, resolveBondOrders(block));
    BondTopology.byBlock.set(block, topology);
    return topology;
  }

  get bondCount(): number {
    return this.atomi.length;
  }

  /** True when at least one bond renders as more than one stick. */
  get hasMultipleSticks(): boolean {
    return this.multipleSticks;
  }

  /** Neighbour plane frame over `atomCount` atoms, built once and reused. */
  plane(atomCount: number): BondPlaneFrame {
    if (!this.planeFrame || this.planeAtomCount !== atomCount) {
      this.planeFrame = BondPlaneFrame.build(this.atomi, this.atomj, atomCount);
      this.planeAtomCount = atomCount;
    }
    return this.planeFrame;
  }
}
