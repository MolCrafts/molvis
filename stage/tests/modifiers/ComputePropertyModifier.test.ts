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
    atoms.setColF("x", new Float64Array([0, 1, 2]));
    atoms.setColF("y", new Float64Array([0, 0, 0]));
    atoms.setColF("z", new Float64Array([0, 0, 0]));
    atoms.setColStr("element", ["H", "C", "H"]);
    frame.insertBlock("atoms", atoms);
    const mod = new ComputePropertyModifier();
    mod.setExpression("x + 1");
    mod.setOutputColumn("Compute");
    const out = mod.apply(frame, createDefaultContext(frame, {} as MolvisApp));
    const col = out.getBlock("atoms")?.viewColF("Compute");
    expect(col?.[0]).toBeCloseTo(1, 6);
    expect(col?.[1]).toBeCloseTo(2, 6);
    expect(col?.[2]).toBeCloseTo(3, 6);
  });
});
