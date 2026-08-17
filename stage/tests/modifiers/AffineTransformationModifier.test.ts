import { Block, Box, Frame } from "@molcrafts/molvis-core/molrs";
import { describe, expect, test } from "@rstest/core";
import "../setup_wasm";
import type { MolvisApp } from "../../src/app";
import { AffineTransformationModifier } from "../../src/modifiers/AffineTransformationModifier";
import { createDefaultContext } from "../../src/pipeline/types";

describe("AffineTransformationModifier", () => {
  const mockApp = {} as MolvisApp;

  test("uniform scale doubles coordinates", () => {
    const frame = new Frame();
    const atoms = new Block();
    atoms.setColF("x", new Float64Array([1, 2]));
    atoms.setColF("y", new Float64Array([0, 0]));
    atoms.setColF("z", new Float64Array([0, 0]));
    atoms.setColStr("element", ["C", "C"]);
    frame.insertBlock("atoms", atoms);

    const mod = new AffineTransformationModifier();
    mod.setUniformScale(2);
    const out = mod.apply(frame, createDefaultContext(frame, mockApp));
    const ox = out.getBlock("atoms")?.viewColF("x");
    expect(ox?.[0]).toBeCloseTo(2, 6);
    expect(ox?.[1]).toBeCloseTo(4, 6);
  });

  test("translation shifts all atoms", () => {
    const frame = new Frame();
    const atoms = new Block();
    atoms.setColF("x", new Float64Array([0]));
    atoms.setColF("y", new Float64Array([0]));
    atoms.setColF("z", new Float64Array([0]));
    atoms.setColStr("element", ["H"]);
    frame.insertBlock("atoms", atoms);

    const mod = new AffineTransformationModifier();
    mod.setTranslation([1, 2, 3]);
    const out = mod.apply(frame, createDefaultContext(frame, mockApp));
    const a = out.getBlock("atoms");
    expect(a?.viewColF("x")?.[0]).toBeCloseTo(1, 6);
    expect(a?.viewColF("y")?.[0]).toBeCloseTo(2, 6);
    expect(a?.viewColF("z")?.[0]).toBeCloseTo(3, 6);
  });

  test("transformCell rebuilds box with scaled lattice", () => {
    const frame = new Frame();
    const atoms = new Block();
    atoms.setColF("x", new Float64Array([1]));
    atoms.setColF("y", new Float64Array([0]));
    atoms.setColF("z", new Float64Array([0]));
    atoms.setColStr("element", ["C"]);
    frame.insertBlock("atoms", atoms);
    frame.box = Box.cube(10, new Float64Array([0, 0, 0]), true, true, true);

    const mod = new AffineTransformationModifier();
    mod.setUniformScale(2);
    mod.setTransformCell(true);
    const out = mod.apply(frame, createDefaultContext(frame, mockApp));
    const L = out.box?.lengths().toCopy() as Float64Array;
    expect(L[0]).toBeCloseTo(20, 5);
  });
});
