import type { Molvis } from "@molcrafts/molvis-stage";
import { useEffect } from "react";
import type { MountOpts } from "@/lib/mount-opts";

/**
 * Seed a Dopamine demo frame onto the boot Empty Scene primary.
 * Opt-in only: `npm run dev:page` via `NODE_ENV=development`, or
 * `?demo=1` / `opts.demo: true`. Does **not** invent a second load path —
 * mutates the existing primary trajectory then auto-attaches Draws.
 */
export function useDevDemo(
  app: Molvis | null,
  setCurrentMode: (mode: string) => void,
  opts: MountOpts,
): void {
  // `process` is injected by the bundler in dev builds but is not a browser
  // global, so reach for it defensively via globalThis (page does not pull in
  // @types/node — declaring a global `process` here would clash with the
  // extension host's node types).
  const proc = (
    globalThis as typeof globalThis & {
      process?: { env?: Record<string, string | undefined> };
    }
  ).process;
  const enabled = opts.demo ?? proc?.env?.NODE_ENV === "development";

  useEffect(() => {
    if (!app) return;
    if (!enabled) return;

    let cameraResetTimer: number | null = null;
    let disposed = false;

    const initDemo = async () => {
      const { Frame, Block, applyAutoAttach } = await import(
        "@molcrafts/molvis-stage"
      );
      if (disposed) return;

      const pipeline = app.modifierPipeline;
      const primary = pipeline.sources()[0];
      if (!primary) return;

      // Already has real content (file / prior seed) — leave it alone.
      const existingAtoms = app.system.frame?.getBlock("atoms")?.nrows() ?? 0;
      if (existingAtoms > 0) return;

      // Dopamine molecule (C₈H₁₁NO₂)
      const atomsBlock = new Block();
      atomsBlock.setColF(
        "x",
        new Float64Array([
          -2.2392, -3.3557, 4.4081, 2.1628, 0.704, 2.9862, -0.0999, 0.1434,
          -1.4642, -1.2209, -2.0247, 2.5111, 2.3332, 2.849, 2.6457, 0.3315,
          0.7594, -1.6445, 4.5468, 4.7362, -3.1541, -3.5639,
        ]),
      );
      atomsBlock.setColF(
        "y",
        new Float64Array([
          1.9626, -0.5612, 0.2624, -0.0212, -0.1603, 0.1008, 0.9759, -1.4267,
          0.8456, -1.557, -0.4208, -0.8817, 0.8564, -0.7888, 0.9593, 1.9659,
          -2.3195, -2.5496, 1.0868, -0.5285, 1.6866, -1.5074,
        ]),
      );
      atomsBlock.setColF(
        "z",
        new Float64Array([
          0.0548, 0.3868, 0.3445, -0.6613, -0.385, 0.6289, -0.2919, -0.2187,
          -0.0326, 0.0407, 0.1336, -1.2481, -1.2993, 1.2541, 1.2192, -0.4187,
          -0.2869, 0.1686, -0.2388, -0.2089, 0.2377, 0.4721,
        ]),
      );
      atomsBlock.setColStr("element", [
        "O",
        "O",
        "N",
        "C",
        "C",
        "C",
        "C",
        "C",
        "C",
        "C",
        "C",
        "H",
        "H",
        "H",
        "H",
        "H",
        "H",
        "H",
        "H",
        "H",
        "H",
        "H",
      ]);

      const bondsBlock = new Block();
      bondsBlock.setColU32(
        "atomi",
        new Uint32Array([
          0, 0, 1, 1, 2, 2, 2, 3, 3, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 9, 9,
        ]),
      );
      bondsBlock.setColU32(
        "atomj",
        new Uint32Array([
          8, 20, 10, 21, 5, 18, 19, 4, 5, 11, 12, 6, 7, 13, 14, 8, 15, 9, 16,
          10, 10, 17,
        ]),
      );
      const bondTypes = new Uint32Array([
        1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 1, 1, 1, 1, 1, 2, 1, 2, 1, 1,
      ]);
      bondsBlock.setColU32("bond_type", bondTypes);
      bondsBlock.setColU32("bond_number", bondTypes);

      const frame = new Frame();
      frame.insertBlock("atoms", atomsBlock);
      frame.insertBlock("bonds", bondsBlock);

      // Single path: write HEAD on the boot primary, attach Draws, pipeline.
      app.system.updateCurrentFrame(frame);
      if (
        primary.kind === "memory" &&
        primary.trajectory !== app.system.trajectory
      ) {
        primary.trajectory.replaceFrame(0, frame);
      }
      primary.filename = "Dopamine";
      primary.sourceType = "empty";

      applyAutoAttach(pipeline, frame, undefined, primary);
      await app.applyPipeline({ fullRebuild: true });
      app.setMode("view");
      setCurrentMode("view");

      cameraResetTimer = window.setTimeout(() => {
        if (disposed) return;
        app.world.fit();
      }, 100);
    };

    void initDemo();

    return () => {
      disposed = true;
      if (cameraResetTimer) window.clearTimeout(cameraResetTimer);
    };
  }, [app, setCurrentMode, enabled]);
}
