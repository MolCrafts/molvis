import { Block, Frame } from "@molcrafts/molvis-core/molrs";
import { describe, expect, test } from "@rstest/core";
import "../setup_wasm";
import type { MolvisApp } from "../../src/app";
import { ComputePropertyModifier } from "../../src/modifiers/ComputePropertyModifier";
import { createDefaultContext } from "../../src/pipeline/types";

describe("ComputePropertyModifier", () => {
  test("writes x + 1 column", () => {
    const frame = new Frame();
    const atoms = new Block();
    atoms.set("x", new Float64Array([0, 1, 2]));
    atoms.set("y", new Float64Array([0, 0, 0]));
    atoms.set("z", new Float64Array([0, 0, 0]));
    atoms.set("element", ["H", "C", "H"]);
    frame.set("atoms", atoms);
    const mod = new ComputePropertyModifier();
    mod.setExpression("x + 1");
    mod.setOutputColumn("Compute");
    const out = mod.apply(frame, createDefaultContext(frame, {} as MolvisApp));
    const col = out.get("atoms").view("Compute") as Float64Array;
    expect(col?.[0]).toBeCloseTo(1, 6);
    expect(col?.[1]).toBeCloseTo(2, 6);
    expect(col?.[2]).toBeCloseTo(3, 6);
  });
});
