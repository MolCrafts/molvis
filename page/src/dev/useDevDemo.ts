import type { MountOpts } from "@/lib/mount-opts";
import type { Molvis } from "@molvis/core";
import { useEffect } from "react";

/**
 * Seed a Dopamine demo frame when the pipeline is empty. Opt-in only:
 * enabled in `npm run dev:page` via `NODE_ENV=development`, or for any
 * deployment that passes `?demo=1` (or `opts.demo: true` to a mount
 * call). Every other embed — VSCode webview, Python/Jupyter, custom
 * `mountMolvisApp` calls — starts with an empty canvas.
 */
export function useDevDemo(
  app: Molvis | null,
  setCurrentMode: (mode: string) => void,
  opts: MountOpts,
): void {
  const enabled =
    opts.demo ??
    (typeof process !== "undefined" && process.env?.NODE_ENV === "development");

  useEffect(() => {
    if (!app) return;
    if (!enabled) return;

    let cameraResetTimer: number | null = null;
    let disposed = false;

    const initDemo = async () => {
      const { FrameDataSource, Frame, Block, Trajectory } = await import(
        "@molvis/core"
      );
      if (disposed) return;
      const pipeline = app.modifierPipeline;
      if (pipeline.getModifiers().length > 0) return;

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
      bondsBlock.setColU32(
        "order",
        new Uint32Array([
          1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 1, 1, 1, 1, 1, 2, 1, 2, 1, 1,
        ]),
      );

      const frame = new Frame();
      frame.insertBlock("atoms", atomsBlock);
      frame.insertBlock("bonds", bondsBlock);

      const sourceMod = new FrameDataSource(frame, {
        sourceType: "empty",
        filename: "Dopamine",
      });
      pipeline.addModifier(sourceMod);
      await app.setTrajectory(new Trajectory([frame]));
      app.setMode("view");
      setCurrentMode("view");

      cameraResetTimer = window.setTimeout(() => {
        app.world.resetCamera();
      }, 100);
    };

    void initDemo();

    return () => {
      disposed = true;
      if (cameraResetTimer) window.clearTimeout(cameraResetTimer);
    };
  }, [app, setCurrentMode, enabled]);
}
