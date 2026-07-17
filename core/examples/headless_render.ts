import { Vector3 } from "@babylonjs/core";
import {
  Block,
  Box,
  DrawIsosurfaceModifier,
  Frame,
  type IsosurfaceStyle,
  MolvisRenderer,
  RegionWireframeOverlay,
  type RegionWireframeSpec,
  type RepresentationId,
  Trajectory,
} from "../src/index";

/**
 * Parse `#rrggbb` to sRGB [0,1] components. The headless capture writes the
 * impostor shader's linear output straight to a non-color-managed render
 * target, so feeding sRGB values directly yields the on-screen / matplotlib
 * look (rather than the dark raw-linear cast you get from `hexToLinearRgb`).
 */
function hexToRgb01(hex: string): [number, number, number] {
  const h = hex.startsWith("#") ? hex.slice(1) : hex;
  return [
    Number.parseInt(h.slice(0, 2), 16) / 255,
    Number.parseInt(h.slice(2, 4), 16) / 255,
    Number.parseInt(h.slice(4, 6), 16) / 255,
  ];
}

/**
 * Headless render harness.
 *
 * Exposes `window.molvisRenderScene(spec)` so an external driver (a Playwright
 * script, a notebook, …) can build a molecular scene, decorate it with
 * confinement-region overlays, frame the camera, and capture a PNG — entirely
 * off-screen, without the three-panel GUI. This is the JS half of molvis's
 * "headless mode": the browser context is supplied by headless Chromium and a
 * real WebGL engine renders the pixels to a render target.
 *
 * The scene is fully described by a plain JSON `RenderSceneSpec`, so the driver
 * never needs to touch BabylonJS or the molrs WASM API directly.
 */

interface ColorRange {
  /** First atom index (inclusive). */
  start: number;
  /** Last atom index (exclusive). */
  end: number;
  /** CSS hex color. */
  color: string;
}

interface CameraSpec {
  /** Azimuthal angle (rad). */
  alpha?: number;
  /** Polar angle (rad). */
  beta?: number;
  /** Look-at target. Default: scene/auto. */
  target?: [number, number, number];
  /** Distance = bounding radius × this factor. Default: keep resetCamera value. */
  radiusScale?: number;
  /** Absolute camera distance from the target (Å). Overrides radiusScale. */
  radius?: number;
}

export interface MolecularStyleSpec {
  /** The single representation used for every atom and bond in the scene. */
  representation?: RepresentationId;
  /** Optional heavy outer outline. Valid only for Flat, Skeletal, and Graph. */
  outline?: boolean;
  /** Global multiplier applied to the representation's atom radius. */
  atomRadiusScale?: number;
  /** Global multiplier applied to the representation's bond radius. */
  bondRadiusScale?: number;
}

export interface RenderSceneSpec {
  atoms: {
    x: number[];
    y: number[];
    z: number[];
    element: string[];
  };
  bonds?: { i: number[]; j: number[] };
  grid?: {
    shape: [number, number, number];
    /** Defaults to a centered Gaussian when omitted. */
    density?: number[];
    boxLength?: number;
    /** Per-surface renderer settings; molecular representation stays global. */
    style?: Partial<IsosurfaceStyle>;
  };
  colorRanges?: ColorRange[];
  /** Wireframe confinement regions of any molpack shape. */
  regions?: RegionWireframeSpec[];
  /** One global molecular style for the complete scene. */
  style?: MolecularStyleSpec;
  /** Background CSS hex, or null/omitted for a transparent capture. */
  background?: string | null;
  width?: number;
  height?: number;
  camera?: CameraSpec;
  /** Capture with a transparent background (alpha = 0). Default: !background. */
  transparent?: boolean;
  /** Trim to the non-transparent bounding box. Default: false. */
  autoCrop?: boolean;
  cropPadding?: number;
}

function buildFrame(spec: RenderSceneSpec): Frame {
  const { x, y, z, element } = spec.atoms;
  const n = element.length;

  const atoms = new Block();
  atoms.setColF("x", Float64Array.from(x));
  atoms.setColF("y", Float64Array.from(y));
  atoms.setColF("z", Float64Array.from(z));
  atoms.setColStr("element", element);

  // Per-atom color overrides (NaN = use element default). Read directly by
  // the atom buffer builder via the __color_r/g/b convention.
  if (spec.colorRanges && spec.colorRanges.length > 0) {
    const r = new Float64Array(n).fill(Number.NaN);
    const g = new Float64Array(n).fill(Number.NaN);
    const b = new Float64Array(n).fill(Number.NaN);
    for (const range of spec.colorRanges) {
      const [cr, cg, cb] = hexToRgb01(range.color);
      for (let k = range.start; k < range.end && k < n; k++) {
        r[k] = cr;
        g[k] = cg;
        b[k] = cb;
      }
    }
    atoms.setColF("__color_r", r);
    atoms.setColF("__color_g", g);
    atoms.setColF("__color_b", b);
  }

  const frame = new Frame();
  frame.insertBlock("atoms", atoms);

  if (spec.bonds && spec.bonds.i.length > 0) {
    const bonds = new Block();
    bonds.setColU32("atomi", Uint32Array.from(spec.bonds.i));
    bonds.setColU32("atomj", Uint32Array.from(spec.bonds.j));
    bonds.setColU32("order", new Uint32Array(spec.bonds.i.length).fill(1));
    frame.insertBlock("bonds", bonds);
  }

  if (spec.grid) {
    const [nx, ny, nz] = spec.grid.shape;
    const density =
      spec.grid.density ??
      Array.from({ length: nx * ny * nz }, (_, index) => {
        const ix = Math.floor(index / (ny * nz));
        const iy = Math.floor((index % (ny * nz)) / nz);
        const iz = index % nz;
        const dx = ix - (nx - 1) / 2;
        const dy = iy - (ny - 1) / 2;
        const dz = iz - (nz - 1) / 2;
        const sigma2 = (Math.min(nx, ny, nz) / 4) ** 2;
        return Math.exp(-(dx * dx + dy * dy + dz * dz) / sigma2);
      });
    const grid = frame.createBlock("grid");
    grid.setColF("density", Float64Array.from(density));
    grid.setShape(Uint32Array.from(spec.grid.shape));
    frame.simbox = Box.cube(
      new Float64Array([spec.grid.boxLength ?? 10]),
      new Float64Array([0, 0, 0]),
      false,
      false,
      false,
    );
  }

  return frame;
}

async function renderScene(spec: RenderSceneSpec): Promise<string> {
  const width = spec.width ?? 1200;
  const height = spec.height ?? 1200;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  document.body.appendChild(canvas);

  const renderer = new MolvisRenderer(canvas);
  try {
    renderer.setSize(width, height);
    renderer.setResolution(width, height);

    const frame = buildFrame(spec);
    console.log("[hr] loading frame…");
    await renderer.load(new Trajectory([frame]));
    console.log("[hr] loaded");

    if (spec.grid?.style) {
      const modifier = renderer.app.modifierPipeline
        .getModifiers()
        .find((item) => item instanceof DrawIsosurfaceModifier);
      if (modifier instanceof DrawIsosurfaceModifier) {
        modifier.setStyle(spec.grid.style);
        await renderer.app.applyPipeline({ fullRebuild: true });
      }
    }

    if (spec.background) renderer.setBackgroundColor(spec.background);

    const molecularStyle = spec.style ?? {};
    await renderer.setRepresentation(
      molecularStyle.representation ?? "ball-and-stick",
    );
    if (molecularStyle.outline !== undefined) {
      await renderer.setRepresentationOutline(molecularStyle.outline);
    }
    let radiusChanged = false;
    if (molecularStyle.atomRadiusScale !== undefined) {
      assertPositiveScale(
        molecularStyle.atomRadiusScale,
        "style.atomRadiusScale",
      );
      renderer.app.styleManager.setAtomRadiusScale(
        molecularStyle.atomRadiusScale,
      );
      radiusChanged = true;
    }
    if (molecularStyle.bondRadiusScale !== undefined) {
      assertPositiveScale(
        molecularStyle.bondRadiusScale,
        "style.bondRadiusScale",
      );
      renderer.app.styleManager.setBondRadiusScale(
        molecularStyle.bondRadiusScale,
      );
      radiusChanged = true;
    }
    if (radiusChanged) {
      await renderer.app.applyPipeline({ fullRebuild: true });
    }

    // Wireframe confinement regions (cavity, slab, channel, …).
    (spec.regions ?? []).forEach((region, idx) => {
      renderer.app.overlayManager.add(
        new RegionWireframeOverlay(
          `region-${idx}`,
          region,
          renderer.app.world.scene,
        ),
      );
    });

    // Frame the scene, then apply any explicit camera overrides. The camera is
    // an ArcRotateCamera; alpha/beta/radius give a fully deterministic pose.
    renderer.resetCamera();
    applyCamera(renderer, spec);
    const dcam = renderer.app.world.camera;
    console.log(
      `[hr] camera framed; radius=${dcam.radius.toFixed(1)} fov=${dcam.fov.toFixed(3)} ` +
        `alpha=${dcam.alpha.toFixed(2)} beta=${dcam.beta.toFixed(2)} ` +
        `aspect=${renderer.app.scene.getEngine().getAspectRatio(dcam).toFixed(2)}`,
    );

    const transparent = spec.transparent ?? !spec.background;
    // `screenshot()` uses CreateScreenshotUsingRenderTargetAsync, which only
    // resolves once the engine renders a frame. The headless renderer has no
    // interactive loop, so drive one explicitly for the duration of the
    // capture, then stop it.
    const scene = renderer.app.world.scene;
    const engine = scene.getEngine();
    engine.runRenderLoop(() => scene.render());
    let png: string;
    try {
      png = await renderer.snapshot({
        width,
        height,
        transparentBackground: transparent,
        autoCrop: spec.autoCrop ?? false,
        cropPadding: spec.cropPadding ?? 8,
      });
    } finally {
      engine.stopRenderLoop();
    }
    console.log("[hr] captured");
    return png;
  } finally {
    // Leave the renderer alive only as long as the capture; dispose to free GL.
    renderer.dispose();
    canvas.remove();
  }
}

function assertPositiveScale(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be a finite number greater than zero`);
  }
}

function applyCamera(renderer: MolvisRenderer, spec: RenderSceneSpec): void {
  const cam = renderer.app.world.camera;
  const c = spec.camera;
  if (!c) return;
  if (c.target)
    cam.setTarget(new Vector3(c.target[0], c.target[1], c.target[2]));
  if (c.alpha !== undefined) cam.alpha = c.alpha;
  if (c.beta !== undefined) cam.beta = c.beta;
  if (c.radiusScale !== undefined) cam.radius = cam.radius * c.radiusScale;
  if (c.radius !== undefined) cam.radius = c.radius;
}

declare global {
  interface Window {
    molvisRenderScene: (spec: RenderSceneSpec) => Promise<string>;
    molvisReady: boolean;
  }
}

window.molvisRenderScene = renderScene;
window.molvisReady = true;
console.log("✅ molvis headless render harness ready");
