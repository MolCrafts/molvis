import { Tools } from "@babylonjs/core";
import {
  type CropBounds,
  contentBounds,
  cropToRect,
} from "@molcrafts/molvis-core/image-crop";
import type { MolvisApp } from "../app";
import { Command, command } from "./base";

/** What a snapshot captures. Every field is optional. */
export interface SnapshotOptions {
  /** Output size as a multiple of the canvas size (default 1). */
  scale?: number;
  /** Render the background transparent (default false; implied by a crop). */
  transparent?: boolean;
  /** Draw the axis gizmo (default true). */
  axes?: boolean;
  /** Crop to the content with this margin in output pixels (default: no crop). */
  cropMargin?: number;
}

/** Validated {@link SnapshotOptions}. */
export interface ResolvedSnapshot {
  scale: number;
  transparent: boolean;
  axes: boolean;
  cropMargin: number | null;
}

/**
 * Check snapshot options and fill their defaults.
 *
 * @throws when a field has the wrong type or range, or the gizmo is asked for
 * in a capture that cannot draw it.
 */
export function resolveSnapshotOptions(args: unknown): ResolvedSnapshot {
  const raw = (args ?? {}) as Record<string, unknown>;
  const scale = raw.scale ?? 1;
  if (typeof scale !== "number" || !Number.isFinite(scale) || scale <= 0) {
    throw new Error("snapshot scale must be a finite number > 0");
  }
  const flag = (name: string, fallback: boolean): boolean => {
    const value = raw[name] ?? fallback;
    if (typeof value !== "boolean") {
      throw new Error(`snapshot ${name} must be a boolean`);
    }
    return value;
  };
  const cropMargin = raw.cropMargin ?? null;
  // The crop scans the alpha channel, so a cropped capture is transparent.
  if (cropMargin !== null && raw.transparent === false) {
    throw new Error("snapshot crop needs a transparent background");
  }
  const transparent = flag("transparent", cropMargin !== null);
  const axes = flag("axes", true);
  if (
    cropMargin !== null &&
    (typeof cropMargin !== "number" ||
      !Number.isInteger(cropMargin) ||
      cropMargin < 0)
  ) {
    throw new Error("snapshot cropMargin must be a non-negative integer");
  }
  if (axes && (scale !== 1 || transparent)) {
    throw new Error(
      "snapshot axes are drawn only in a scale-1 opaque uncropped capture; pass axes: false",
    );
  }
  return { scale, transparent, axes, cropMargin: cropMargin as number | null };
}

/** A snapshot: the PNG, and where a crop took it from in the full render. */
export interface SnapshotResult {
  /** PNG data URL. */
  data: string;
  /** The cropped rectangle in full-render pixels, or `null` when uncropped. */
  crop: CropBounds | null;
  /** Output pixels per canvas (CSS) pixel. */
  scale: number;
}

/**
 * Take a snapshot of the current view as a PNG data URL.
 *
 * The default captures the canvas as shown, axis gizmo included. Without the
 * gizmo the scene is rendered again offscreen at `scale` times the canvas size
 * by {@link MolvisApp.screenshot}, which draws the molecular scene only and
 * can make the background transparent; `cropMargin` then trims it to its
 * content. The result says which rectangle the crop kept, so a canvas point
 * `(x, y)` lands at `(x·scale − crop.x, y·scale − crop.y)` in the PNG.
 */
@command("take_snapshot")
export class TakeSnapshotCommand extends Command<SnapshotResult> {
  private readonly options: ResolvedSnapshot;

  constructor(app: MolvisApp, args: unknown) {
    super(app);
    this.options = resolveSnapshotOptions(args);
  }

  async do(): Promise<SnapshotResult> {
    const scene = this.app.world.scene;
    const camera = scene.activeCamera;
    if (!camera) throw new Error("No active camera");
    const engine = scene.getEngine();
    const { scale, transparent, axes, cropMargin } = this.options;
    const width = Math.round(engine.getRenderWidth() * scale);
    const height = Math.round(engine.getRenderHeight() * scale);
    // Output pixels per CSS pixel: the render buffer may be at device ratio.
    const cssWidth = engine.getRenderingCanvas()?.clientWidth || width / scale;
    const perCss = width / cssWidth;
    if (axes) {
      const data = await Tools.CreateScreenshotAsync(engine, camera, {
        width,
        height,
      });
      return { data, crop: null, scale: perCss };
    }
    const full = await this.app.screenshot({
      width,
      height,
      transparentBackground: transparent,
      format: "png",
    });
    if (cropMargin === null) return { data: full, crop: null, scale: perCss };
    const crop = await contentBounds(full, { padding: cropMargin });
    if (!crop) return { data: full, crop: null, scale: perCss };
    return {
      data: await cropToRect(full, crop, "image/png", 1),
      crop,
      scale: perCss,
    };
  }

  undo(): Command {
    return this;
  }
}
