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
    atoms.set("x", new Float64Array([1, 2]));
    atoms.set("y", new Float64Array([0, 0]));
    atoms.set("z", new Float64Array([0, 0]));
    atoms.set("element", ["C", "C"]);
    frame.set("atoms", atoms);

    const mod = new AffineTransformationModifier();
    mod.setUniformScale(2);
    const out = mod.apply(frame, createDefaultContext(frame, mockApp));
    const ox = out.get("atoms").view("x") as Float64Array;
    expect(ox?.[0]).toBeCloseTo(2, 6);
    expect(ox?.[1]).toBeCloseTo(4, 6);
  });

  test("translation shifts all atoms", () => {
    const frame = new Frame();
    const atoms = new Block();
    atoms.set("x", new Float64Array([0]));
    atoms.set("y", new Float64Array([0]));
    atoms.set("z", new Float64Array([0]));
    atoms.set("element", ["H"]);
    frame.set("atoms", atoms);

    const mod = new AffineTransformationModifier();
    mod.setTranslation([1, 2, 3]);
    const out = mod.apply(frame, createDefaultContext(frame, mockApp));
    const a = out.has("atoms") ? out.get("atoms") : undefined;
    expect((a?.view("x") as Float64Array)?.[0]).toBeCloseTo(1, 6);
    expect((a?.view("y") as Float64Array)?.[0]).toBeCloseTo(2, 6);
    expect((a?.view("z") as Float64Array)?.[0]).toBeCloseTo(3, 6);
  });

  test("transformCell rebuilds box with scaled lattice", () => {
    const frame = new Frame();
    const atoms = new Block();
    atoms.set("x", new Float64Array([1]));
    atoms.set("y", new Float64Array([0]));
    atoms.set("z", new Float64Array([0]));
    atoms.set("element", ["C"]);
    frame.set("atoms", atoms);
    frame.box = Box.cube(10, new Float64Array([0, 0, 0]), true, true, true);

    const mod = new AffineTransformationModifier();
    mod.setUniformScale(2);
    mod.setTransformCell(true);
    const out = mod.apply(frame, createDefaultContext(frame, mockApp));
    const L = out.box?.lengths().toCopy() as Float64Array;
    expect(L[0]).toBeCloseTo(20, 5);
  });
});
