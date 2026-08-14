import { NullEngine, Scene } from "@babylonjs/core";
import { Block } from "@molcrafts/molvis-core/molrs";
import { describe, expect, it } from "@rstest/core";
import { buildAtomBuffers } from "../../src/artist/atom_buffer";
import {
  BALL_AND_STICK,
  BUBBLE,
  SPACEFILL,
} from "../../src/artist/representation";
import { StyleManager } from "../../src/artist/style_manager";

function makeScene(): Scene {
  return new Scene(new NullEngine());
}

function carbonBlock(): Block {
  const atoms = new Block();
  atoms.setColF("x", new Float64Array([0]));
  atoms.setColF("y", new Float64Array([0]));
  atoms.setColF("z", new Float64Array([0]));
  atoms.setColStr("element", ["C"]);
  return atoms;
}

describe("bubble vs spacefill radii", () => {
  it("StyleManager resolves different radii for C", () => {
    const sm = new StyleManager(makeScene());
    sm.setRepresentation(BUBBLE);
    const bubbleR = sm.getAtomStyle("C").radius;
    sm.setRepresentation(SPACEFILL);
    const spacefillR = sm.getAtomStyle("C").radius;
    // bubble: covalent~0.77 * 1.35 ≈ 1.04; spacefill: vdW 1.91
    expect(bubbleR).toBeCloseTo(0.77 * 0.8 * 1.35, 2);
    expect(spacefillR).toBeCloseTo(1.91, 2);
    expect(spacefillR / bubbleR).toBeGreaterThan(1.5);
  });

  it("buildAtomBuffers encodes the difference into instanceData", () => {
    const sm = new StyleManager(makeScene());
    const block = carbonBlock();

    sm.setRepresentation(BUBBLE);
    const bubbleBuf = buildAtomBuffers(block, sm, 1);
    const bubbleR = bubbleBuf.get("instanceData")![3];

    sm.setRepresentation(SPACEFILL);
    const sfBuf = buildAtomBuffers(block, sm, 1);
    const sfR = sfBuf.get("instanceData")![3];

    expect(sfR / bubbleR).toBeGreaterThan(1.5);
  });

  it("ball-and-stick is smaller than both", () => {
    const sm = new StyleManager(makeScene());
    sm.setRepresentation(BALL_AND_STICK);
    const bas = sm.getAtomStyle("C").radius;
    sm.setRepresentation(BUBBLE);
    const bubble = sm.getAtomStyle("C").radius;
    sm.setRepresentation(SPACEFILL);
    const sf = sm.getAtomStyle("C").radius;
    expect(bas).toBeLessThan(bubble);
    expect(bubble).toBeLessThan(sf);
  });
});
