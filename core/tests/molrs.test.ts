import { describe, expect, it } from "@rstest/core";
import { Block, Frame, generate3D, parseSMILES } from "../src/molrs";

describe("molrs gateway", () => {
  it("constructs Frame and Block", () => {
    const frame = new Frame();
    const block = new Block();
    block.setColStr("element", ["C", "O"]);
    frame.insertBlock("atoms", block);
    expect(frame.getBlock("atoms")?.nrows()).toBe(2);
    frame.free();
  });

  it("parseSMILES + generate3D water path", () => {
    const ir = parseSMILES("O");
    const f2 = ir.toFrame();
    const f3 = generate3D(f2, "fast", 1);
    const atoms = f3.getBlock("atoms");
    expect(atoms).toBeDefined();
    expect((atoms?.nrows() ?? 0) > 0).toBe(true);
    f2.free();
    f3.free();
    ir.free();
  });

  it("UFFTypifier + LBFGS(pots, nlist).run composition on ethanol", async () => {
    const { LBFGS, LinkedCell, UFFTypifier } = await import("../src/molrs");
    const ir = parseSMILES("CCO");
    const f2 = ir.toFrame();
    const f3 = generate3D(f2, "fast", 1);
    f2.free();
    ir.free();

    const typifier = new UFFTypifier();
    const typed = typifier.typify(f3);
    const pots = typifier.toPotentials(typed);
    // Always pass a spatial NL (UFF nonbonded shell ~12.5 Å). Never omit —
    // omitted NL uses O(N²) internal pairs and panics on mid-size systems.
    const cell = new LinkedCell(12.5, true, false);
    const nlist = cell.build(typed);
    const opt = new LBFGS(pots, nlist, 0.1);
    const report = opt.run(typed, 50);

    expect(report.steps).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(report.energy)).toBe(true);
    expect(typeof report.converged).toBe("boolean");

    report.free();
    opt.free();
    pots.free();
    typed.free();
    typifier.free();
    cell.free();
    f3.free();
  });
});
