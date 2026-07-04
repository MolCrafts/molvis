import { type Engine, NullEngine } from "@babylonjs/core";
import { describe, expect, it } from "@rstest/core";
import "./setup_wasm";
import { MolvisApp } from "../src/app";
import { loadFileContent } from "../src/io";

/**
 * End-to-end of the vsc-ext "open a `.data`, then drop an `.xyz` trajectory"
 * workflow: dropping the trajectory in `"auto"` mode must keep the bonds /
 * angles from the structure already on screen while animating the positions
 * from each trajectory frame.
 *
 * Drives a real {@link MolvisApp} on a {@link NullEngine} (no GPU) through the
 * actual `loadFileContent` dispatch — the same call the webview controller
 * makes — so the merge, synthesis, and auto-attach all run for real.
 */

// 3-atom structure with 2 bonds (atom_style full). All atoms sit at x = 0; the
// dropped trajectory must move them, proving positions come from the xyz.
const DATA = `LAMMPS data file

3 atoms
2 bonds
1 atom types
1 bond types

0.0 10.0 xlo xhi
0.0 10.0 ylo yhi
0.0 10.0 zlo zhi

Masses

1 12.011

Atoms

1 1 1 0.0 0.0 0.0 0.0
2 1 1 0.0 0.0 1.0 0.0
3 1 1 0.0 0.0 2.0 0.0

Bonds

1 1 1 2
2 1 2 3
`;

// Same 3 atoms, 2 frames, distinct x per frame so we can tell which frame is live.
const XYZ = `3
frame 0
C 10.0 0.0 0.0
C 11.0 0.0 0.0
C 12.0 0.0 0.0
3
frame 1
C 20.0 0.0 0.0
C 21.0 0.0 0.0
C 22.0 0.0 0.0
`;

function makeCanvas(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  return canvas;
}

function makeHeadlessApp(engine: Engine): MolvisApp {
  return new MolvisApp(makeCanvas(), { gui: false, engine });
}

// The rendered scene is the pipeline's *merged* frame (atoms from the
// trajectory + bonds broadcast from the topology overlay), not the raw
// primary-trajectory frame on `system`. Assert on what actually gets drawn.
async function mergedBondCount(app: MolvisApp, index: number): Promise<number> {
  const merged = await app.modifierPipeline.compute(index, app);
  return merged.getBlock("bonds")?.nrows() ?? 0;
}

async function mergedXCoords(app: MolvisApp, index: number): Promise<number[]> {
  const merged = await app.modifierPipeline.compute(index, app);
  const x = merged.getBlock("atoms")?.copyColF("x");
  return x ? Array.from(x) : [];
}

function hasDrawBonds(app: MolvisApp): boolean {
  return app.modifierPipeline
    .getModifiers()
    .some((m) => m.name === "Draw Bonds");
}

describe("auto-merge: open .data, drop .xyz trajectory", () => {
  it("keeps topology (bonds) and animates positions from the trajectory", async () => {
    const engine = new NullEngine();
    const app = makeHeadlessApp(engine);
    try {
      await app.start();

      // 1) Open the .data structure (single frame, carries bonds).
      await loadFileContent(app, DATA, "topo.data", "lammps", "replace");
      expect(app.system.trajectory.length).toBe(1);
      expect(await mergedBondCount(app, 0)).toBe(2);
      expect(hasDrawBonds(app)).toBe(true);

      // 2) Drop the multi-frame .xyz trajectory in "auto" mode.
      await loadFileContent(app, XYZ, "traj.xyz", "xyz", "auto");

      // Trajectory now drives the timeline...
      expect(app.system.trajectory.length).toBe(2);
      // ...positions come from xyz frame 0...
      expect(await mergedXCoords(app, 0)).toEqual([10, 11, 12]);
      // ...topology (bonds) survives the merge and is still rendered.
      expect(await mergedBondCount(app, 0)).toBe(2);
      expect(hasDrawBonds(app)).toBe(true);

      // 3) Frame 1 advances coordinates while bonds stay put.
      expect(await mergedXCoords(app, 1)).toEqual([20, 21, 22]);
      expect(await mergedBondCount(app, 1)).toBe(2);
    } finally {
      app.destroy();
    }
  });
});
