import { Box, Frame } from "@molcrafts/molvis-core/molrs";
import { describe, expect, it } from "@rstest/core";
import { applyAutoAttach } from "../../src/pipeline/auto_attach";
import { DrawBoxModifier } from "../../src/pipeline/draw_box";
import { ModifierPipeline } from "../../src/pipeline/pipeline";
import "../setup_wasm";

function proteinWithBox(): Frame {
  const frame = new Frame();
  const atoms = frame.createBlock("atoms");
  atoms.setColF("x", new Float64Array([-5, -4, -3, -2.5]));
  atoms.setColF("y", new Float64Array([-5, -5, -5, -4]));
  atoms.setColF("z", new Float64Array([-5, -5, -5, -5]));
  atoms.setColStr("element", ["N", "C", "C", "O"]);
  atoms.setColStr("name", ["N", "CA", "C", "O"]);
  atoms.setColStr("res_name", ["GLY", "GLY", "GLY", "GLY"]);
  atoms.setColI32("res_seq", new Int32Array([1, 1, 1, 1]));
  atoms.setColStr("chain_id", ["A", "A", "A", "A"]);
  frame.box = Box.cube(50.0, new Float64Array([0, 0, 0]), true, true, true);
  return frame;
}

describe("applyAutoAttach must not attach analysis/viz noise", () => {
  it("only attaches default visuals for a protein+box frame", () => {
    const pipeline = new ModifierPipeline();
    const attached = applyAutoAttach(pipeline, proteinWithBox());
    expect(attached).toContain("Particles");
    expect(attached).toContain("Cartoon");
    expect(attached).toContain("Simulation cell");
    // Analysis / optional surfaces must NOT auto-attach (they used to,
    // which overwrote CPK colors and spawned PBC-wrapped density blobs).
    expect(attached).not.toContain("Gaussian density surface");
    expect(attached).not.toContain("Construct surface mesh");
    expect(attached).not.toContain("Steinhardt order");
    expect(attached).not.toContain("Solid-liquid");
  });

  it("attaches Simulation cell disabled for EM 1×1×1 placeholder cells", () => {
    const frame = new Frame();
    const atoms = frame.createBlock("atoms");
    atoms.setColF("x", new Float64Array([0]));
    atoms.setColF("y", new Float64Array([0]));
    atoms.setColF("z", new Float64Array([0]));
    atoms.setColStr("element", ["C"]);
    // Exactly 1 Å edges — present but not drawable by default.
    frame.box = Box.cube(1, new Float64Array([0, 0, 0]), true, true, true);

    const pipeline = new ModifierPipeline();
    const attached = applyAutoAttach(pipeline, frame);
    expect(attached).toContain("Simulation cell");
    const cell = pipeline
      .getEntries()
      .find((m): m is DrawBoxModifier => m instanceof DrawBoxModifier);
    expect(cell).toBeTruthy();
    expect(cell!.enabled).toBe(false);
    frame.free();
  });
});
