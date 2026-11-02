import { describe, expect, it } from "@rstest/core";
import "../setup_wasm";
import { Conformer, SmilesIr } from "@molcrafts/molvis-core/molrs";
import { withKekuleOrders } from "../../src/utils/kekule";

describe("withKekuleOrders (assignKekuleBondOrders)", () => {
  it("fills bond_number on benzene without changing bond_type", () => {
    const ir = SmilesIr.parse("c1ccccc1");
    const f2 = ir.toFrame();
    const conformer = new Conformer("fast", null, 42);
    const f3 = conformer.generate(f2);
    conformer.free();
    f2.free();
    ir.free();

    const out = withKekuleOrders(f3);
    const bonds = out.get("bonds")!;
    const types = Array.from(bonds.view("bond_type") ?? [], Number);
    const numbers = Array.from(bonds.view("bond_number") ?? [], Number);
    const ring = types
      .map((t, i) => ({ t, n: numbers[i] }))
      .filter((x) => x.t === 4);

    expect(ring.length).toBe(6);
    expect(ring.every((x) => x.n === 1 || x.n === 2)).toBe(true);
    expect(ring.filter((x) => x.n === 2).length).toBe(3);
    expect(ring.filter((x) => x.n === 1).length).toBe(3);

    f3.free();
    out.free();
  });
});
