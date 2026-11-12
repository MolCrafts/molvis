import { toDomainUint } from "@molcrafts/molvis-core";
import { Block } from "@molcrafts/molvis-core/molrs";
import { describe, expect, it } from "@rstest/core";
import "../setup_wasm";
import { BondTopology } from "../../src/artist/bond_topology";

function bondsBlock(pairs: Array<[number, number]>, orders?: number[]): Block {
  const block = new Block();
  block.set("atomi", toDomainUint(pairs.map((p) => p[0])));
  block.set("atomj", toDomainUint(pairs.map((p) => p[1])));
  if (orders) {
    block.set("bond_type", toDomainUint(orders));
    block.set("bond_number", toDomainUint(orders));
  }
  return block;
}

describe("BondTopology", () => {
  it("copies endpoints into Uint32Arrays and resolves stick counts once", () => {
    const block = bondsBlock(
      [
        [0, 1],
        [1, 2],
      ],
      [1, 2],
    );
    const topology = BondTopology.of(block);
    expect(topology).toBeDefined();
    expect(Array.from(topology!.atomi)).toEqual([0, 1]);
    expect(Array.from(topology!.atomj)).toEqual([1, 2]);
    expect(Array.from(topology!.orders ?? [])).toEqual([1, 2]);
    expect(topology!.bondCount).toBe(2);
    expect(topology!.hasMultipleSticks).toBe(true);
  });

  it("memoizes on the block handle", () => {
    const block = bondsBlock([[0, 1]]);
    expect(BondTopology.of(block)).toBe(BondTopology.of(block));
    expect(BondTopology.of(block)?.orders).toBeNull();
    expect(BondTopology.of(block)?.hasMultipleSticks).toBe(false);
  });

  it("is undefined without canonical atomi/atomj columns", () => {
    const block = new Block();
    block.set("id_i", toDomainUint([1]));
    block.set("id_j", toDomainUint([2]));
    expect(BondTopology.of(block)).toBeUndefined();
  });

  it("builds the plane frame once per atom count", () => {
    const topology = BondTopology.of(bondsBlock([[0, 1]]))!;
    const plane = topology.plane(2);
    expect(topology.plane(2)).toBe(plane);
    expect(topology.plane(3)).not.toBe(plane);
  });
});
