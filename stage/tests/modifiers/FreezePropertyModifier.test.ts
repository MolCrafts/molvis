import { Block, Frame } from "@molcrafts/molvis-core/molrs";
import { describe, expect, test } from "@rstest/core";
import "../setup_wasm";
import type { MolvisApp } from "../../src/app";
import { FreezePropertyModifier } from "../../src/modifiers/FreezePropertyModifier";
import { createDefaultContext } from "../../src/pipeline/types";

describe("FreezePropertyModifier", () => {
  test("restores frozen x on second apply", () => {
    const f1 = new Frame();
    const a1 = new Block();
    a1.set("x", new Float64Array([1, 2]));
    a1.set("y", new Float64Array([0, 0]));
    a1.set("z", new Float64Array([0, 0]));
    a1.set("element", ["C", "C"]);
    f1.set("atoms", a1);

    const mod = new FreezePropertyModifier();
    mod.setColumn("x");
    const o1 = mod.apply(f1, createDefaultContext(f1, {} as MolvisApp));
    expect((o1.get("atoms").view("x") as Float64Array)?.[0]).toBeCloseTo(1, 6);

    const f2 = new Frame();
    const a2 = new Block();
    a2.set("x", new Float64Array([9, 8]));
    a2.set("y", new Float64Array([0, 0]));
    a2.set("z", new Float64Array([0, 0]));
    a2.set("element", ["C", "C"]);
    f2.set("atoms", a2);
    const o2 = mod.apply(f2, createDefaultContext(f2, {} as MolvisApp));
    expect((o2.get("atoms").view("x") as Float64Array)?.[0]).toBeCloseTo(1, 6);
    expect((o2.get("atoms").view("x") as Float64Array)?.[1]).toBeCloseTo(2, 6);
  });
});
