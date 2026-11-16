/**
 * Draw surface — the one step that paints computed surface geometry.
 *
 * Every surface algorithm ends in triangles, so every surface algorithm can
 * share this. A producer publishes {@link SurfacePart}s into
 * `context.surfaces` under its own id; this reads the ones belonging to its
 * producer and hands them to the surface renderer. Adding a seventh algorithm
 * touches no rendering code at all.
 *
 * The split also makes appearance cheap. Colour and opacity live here, not on
 * the algorithm, so changing them repaints without re-running marching cubes
 * — or, worse, a Delaunay tetrahedralisation.
 */

import type { Frame } from "@molcrafts/molvis-core/molrs";
import type { SurfacePart } from "../algo/surface_mesh";
import type { MolvisApp } from "../app";
import {
  DEFAULT_SURFACE_DRAW_STYLE,
  type SurfaceDrawStyle,
} from "../artist/surface/surface_mesh_renderer";
import { type ProjectParams, readEnum, readNumber } from "../project/params";
import { BaseModifier, ModifierCapability } from "./modifier";
import type { PipelineContext } from "./types";

export class DrawSurfaceModifier extends BaseModifier {
  static readonly NAME = "Draw surface";

  /** The `ProducesGeometry` modifier whose parts this paints. */
  producerId: string | null = null;
  private _style: SurfaceDrawStyle = { ...DEFAULT_SURFACE_DRAW_STYLE };
  private _app: MolvisApp | null = null;
  /**
   * The parts array painted onto the GPU, for the identity check in
   * {@link apply}. A producer that recomputes every pass hands back a new
   * array and repaints; one whose geometry is fixed (an imported mesh) hands
   * back the same array and is left alone, instead of re-uploading its
   * vertices on every trajectory step.
   */
  private _paintedParts: readonly SurfacePart[] | null = null;

  constructor(id = "draw-surface", producerId: string | null = null) {
    super(id, DrawSurfaceModifier.NAME, new Set([ModifierCapability.Draws]));
    this.producerId = producerId;
  }

  get style(): SurfaceDrawStyle {
    return this._style;
  }

  setStyle(patch: Partial<SurfaceDrawStyle>): void {
    this._style = { ...this._style, ...patch };
    this._paintedParts = null;
  }

  /**
   * Appearance has to survive a save, and so does the producer link — a draw
   * whose producer id was not remapped on load paints nothing forever.
   */
  toProjectParams(): ProjectParams {
    return {
      producerId: this.producerId,
      color: [...this._style.color],
      secondaryColor: [...this._style.secondaryColor],
      opacity: this._style.opacity,
      finish: this._style.finish,
      contourSpacing: this._style.contourSpacing,
    };
  }

  fromProjectParams(params: ProjectParams): void {
    if (typeof params.producerId === "string") {
      this.producerId = params.producerId;
    }
    this._style = {
      color: readColor(params.color, this._style.color),
      secondaryColor: readColor(
        params.secondaryColor,
        this._style.secondaryColor,
      ),
      opacity: readNumber(params.opacity, this._style.opacity),
      finish: readEnum(
        params.finish,
        ["solid", "mesh", "contour", "dot"] as const,
        this._style.finish,
      ),
      contourSpacing: readNumber(
        params.contourSpacing,
        this._style.contourSpacing,
      ),
    };
    this._paintedParts = null;
  }

  /** Never a default layer: it arrives with the producer that needs it. */
  matches(_frame: Frame): boolean {
    return false;
  }

  getCacheKey(): string {
    const s = this._style;
    return `${super.getCacheKey()}:p=${this.producerId ?? "-"}:rgb=${s.color.join(",")}:rgb2=${s.secondaryColor.join(",")}:o=${s.opacity}:f=${s.finish}`;
  }

  apply(input: Frame, ctx: PipelineContext): Frame {
    this._app = ctx.app;
    const parts = this.producerId
      ? (ctx.surfaces.get(this.producerId) ?? [])
      : [];
    // A producer that is disabled, refused, or found nothing publishes
    // nothing — clearing here is what makes the surface disappear with it.
    if (parts.length === 0) {
      ctx.app.artist.surfaceLayer(this.id).dispose();
      this._paintedParts = null;
      return input;
    }
    // `hasData` is the second half of the check: the artist drops its meshes
    // on a scene replace without telling this modifier, and a repaint is due
    // whenever the layer came back empty.
    if (
      parts === this._paintedParts &&
      ctx.app.artist.surfaceLayer(this.id).hasData
    ) {
      return input;
    }
    ctx.app.artist.drawSurfaceParts(this.id, parts, this._style);
    this._paintedParts = parts;
    return input;
  }

  applyVisibility(app: MolvisApp, visible: boolean): void {
    app.artist.surfaceLayer(this.id).setVisible(visible);
  }

  onRemoved(): void {
    this._app?.artist.releaseSurfaceLayer(this.id);
    this._app = null;
    this._paintedParts = null;
  }
}

function readColor(
  value: unknown,
  fallback: [number, number, number],
): [number, number, number] {
  if (!Array.isArray(value) || value.length !== 3) return fallback;
  const channels = value.map((c) =>
    typeof c === "number" && Number.isFinite(c)
      ? Math.max(0, Math.min(1, c))
      : null,
  );
  return channels.every((c) => c !== null)
    ? (channels as [number, number, number])
    : fallback;
}
