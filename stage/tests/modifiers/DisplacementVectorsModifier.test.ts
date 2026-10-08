import { Block, Frame } from "@molcrafts/molvis-core/molrs";
import { describe, expect, test } from "@rstest/core";
import "../setup_wasm";
import type { MolvisApp } from "../../src/app";
import {
  DISPLACEMENT_X,
  DisplacementVectorsModifier,
} from "../../src/modifiers/DisplacementVectorsModifier";
import { createDefaultContext } from "../../src/pipeline/types";

describe("DisplacementVectorsModifier", () => {
  test("without trajectory writes zero displacements", () => {
    const frame = new Frame();
    const atoms = new Block();
    atoms.set("x", new Float64Array([1]));
    atoms.set("y", new Float64Array([0]));
    atoms.set("z", new Float64Array([0]));
    atoms.set("element", ["C"]);
    frame.set("atoms", atoms);
    const mod = new DisplacementVectorsModifier();
    const out = mod.apply(frame, createDefaultContext(frame, {} as MolvisApp));
    expect(
      (out.get("atoms").view(DISPLACEMENT_X) as Float64Array)?.[0],
    ).toBeCloseTo(0, 6);
  });
});
