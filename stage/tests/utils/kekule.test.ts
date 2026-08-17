import { describe, expect, it } from "@rstest/core";
import "../setup_wasm";
import { generate3D, parseSMILES } from "@molcrafts/molvis-core/molrs";
import { withKekuleOrders } from "../../src/utils/kekule";

describe("withKekuleOrders (molrs Perceive)", () => {
  it("fills bond_number on benzene without changing bond_type", () => {
    const ir = parseSMILES("c1ccccc1");
    const f2 = ir.toFrame();
    const f3 = generate3D(f2, "fast", 42);
    f2.free();
    ir.free();

    const out = withKekuleOrders(f3);
    const bonds = out.getBlock("bonds")!;
    const types = Array.from(bonds.viewColU32("bond_type") ?? []);
    const numbers = Array.from(bonds.viewColU32("bond_number") ?? []);
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
