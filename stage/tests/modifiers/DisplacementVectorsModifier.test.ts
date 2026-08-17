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
    atoms.setColF("x", new Float64Array([1]));
    atoms.setColF("y", new Float64Array([0]));
    atoms.setColF("z", new Float64Array([0]));
    atoms.setColStr("element", ["C"]);
    frame.insertBlock("atoms", atoms);
    const mod = new DisplacementVectorsModifier();
    const out = mod.apply(frame, createDefaultContext(frame, {} as MolvisApp));
    expect(out.getBlock("atoms")?.viewColF(DISPLACEMENT_X)?.[0]).toBeCloseTo(
      0,
      6,
    );
  });
});
