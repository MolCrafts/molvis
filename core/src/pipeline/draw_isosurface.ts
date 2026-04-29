/**
 * `DrawIsosurfaceModifier` — auto-attaches when a frame carries a 3-D
 * `"grid"` Block and a simbox. Renders an isosurface of the requested
 * channel via the shared `IsosurfaceRenderer`. Mesh installation is a
 * pure side-effect (Draws capability); the frame is returned unchanged.
 *
 * Default isovalue is computed from the channel statistics on the first
 * `apply()` so freshly loaded files render with a sensible default.
 * Subsequent UI edits (slider, channel select, color, opacity) bypass
 * the auto-default by setting `_isovalueAuto = false`.
 */

import type { Frame } from "@molcrafts/molrs";
import {
  DEFAULT_ISOSURFACE_STYLE,
  type IsosurfaceStyle,
  channelIsSigned,
  defaultIsovalueFor,
} from "../artist/isosurface/isosurface_renderer";
import { logger } from "../utils/logger";
import { BaseModifier, ModifierCapability } from "./modifier";
import type { PipelineContext } from "./types";

export class DrawIsosurfaceModifier extends BaseModifier {
  static readonly NAME = "Draw Isosurface";

  private _style: IsosurfaceStyle = { ...DEFAULT_ISOSURFACE_STYLE };
  private _isovalueAuto = true;
  private _channelAuto = true;

  constructor(id = "draw-isosurface") {
    super(id, DrawIsosurfaceModifier.NAME, new Set([ModifierCapability.Draws]));
  }

  /**
   * Auto-attach whenever the frame has a 3-D grid block and a simbox.
   * Both are required: the simbox provides the world transform that
   * marching cubes uses to place each voxel.
   */
  matches(frame: Frame): boolean {
    const grid = frame.getBlock("grid");
    if (!grid) return false;
    const shape = grid.shape();
    if (shape.length !== 3) return false;
    return frame.simbox !== undefined;
  }

  /** Read-only view of the current style — UI binds to this. */
  get style(): IsosurfaceStyle {
    return this._style;
  }

  /**
   * List of column names available on the frame's grid block. Used by
   * the UI to populate the channel selector. Returns an empty list if
   * the frame doesn't carry a grid block.
   */
  static availableChannels(frame: Frame): string[] {
    const grid = frame.getBlock("grid");
    if (!grid) return [];
    const keys = grid.keys();
    // WASM keys() returns Array<any>; coerce each entry to string and
    // filter out empties so the UI never shows a blank option.
    return keys
      .map((k: unknown) => (typeof k === "string" ? k : String(k)))
      .filter((k: string) => k.length > 0);
  }

  /**
   * Statistical range of `channel` on the current frame. Used by the UI
   * to bound the isovalue slider to the data's actual magnitude rather
   * than letting the user drag into ranges where no surface can exist.
   *
   * Returns `{ maxAbs: 0, signed: false }` if the channel is missing or
   * empty — the UI then falls back to a generic 0..1 slider.
   */
  static channelStats(
    frame: Frame,
    channel: string,
  ): { maxAbs: number; signed: boolean } {
    const grid = frame.getBlock("grid");
    if (!grid) return { maxAbs: 0, signed: false };
    let data: Float64Array | undefined;
    try {
      data = grid.copyColF(channel);
    } catch {
      return { maxAbs: 0, signed: false };
    }
    if (!data || data.length === 0) return { maxAbs: 0, signed: false };
    let maxAbs = 0;
    let hasNeg = false;
    let hasPos = false;
    for (let i = 0; i < data.length; i++) {
      const v = data[i];
      const a = Math.abs(v);
      if (a > maxAbs) maxAbs = a;
      if (v < 0) hasNeg = true;
      else if (v > 0) hasPos = true;
    }
    return { maxAbs, signed: hasNeg && hasPos };
  }

  /**
   * Update style fields — UI hook. Setting `channel` clears the
   * "channel was auto-picked" flag so the next apply() respects the
   * user's choice; setting `isovalue` clears `isovalueAuto` likewise.
   * Values that are `undefined` leave the existing setting alone.
   *
   * `isovalue`, `cloudThreshold`, `opacity` are clamped to physical
   * ranges so out-of-band values from the UI (e.g. a stale slider
   * range) can't push the modifier into a no-render state silently.
   */
  setStyle(patch: Partial<IsosurfaceStyle>): void {
    if (patch.channel !== undefined && patch.channel !== this._style.channel) {
      this._channelAuto = false;
      this._isovalueAuto = true; // recompute default for the new channel
    }
    const next: Partial<IsosurfaceStyle> = { ...patch };
    if (next.isovalue !== undefined) {
      // Negative isovalues are valid for spin-difference channels but
      // the modifier always stores a positive magnitude — sign is
      // implied by the +iso / -iso pair when `showNegative` is on.
      next.isovalue = Math.max(0, next.isovalue);
      if (next.isovalue !== this._style.isovalue) this._isovalueAuto = false;
    }
    if (next.opacity !== undefined) {
      next.opacity = Math.max(0, Math.min(1, next.opacity));
    }
    if (next.cloudThreshold !== undefined) {
      next.cloudThreshold = Math.max(0, Math.min(1, next.cloudThreshold));
    }
    if (next.cloudStride !== undefined) {
      next.cloudStride = Math.max(1, Math.floor(next.cloudStride));
    }
    this._style = { ...this._style, ...next };
  }

  /** Reset to defaults so the next apply() re-derives channel/isovalue. */
  resetAuto(): void {
    this._style = { ...DEFAULT_ISOSURFACE_STYLE };
    this._isovalueAuto = true;
    this._channelAuto = true;
  }

  getCacheKey(): string {
    const s = this._style;
    return `${super.getCacheKey()}:c=${s.channel}:iv=${s.isovalue}:o=${s.opacity}:n=${s.showNegative}:rgb=${s.color.join(",")}`;
  }

  apply(input: Frame, ctx: PipelineContext): Frame {
    // Resolve channel before isovalue: the default isovalue depends on
    // the channel's statistics.
    if (this._channelAuto) {
      this.pickChannel(input);
      this._channelAuto = false; // sticky after first auto-pick
    }
    if (this._isovalueAuto) {
      this.pickIsovalue(input);
    }
    logger.info(
      `[DrawIsosurface] apply: channel='${this._style.channel}' iso=${this._style.isovalue.toExponential(3)} showNeg=${this._style.showNegative}`,
    );
    ctx.app.artist.drawIsosurface(input, this._style);
    return input;
  }

  applyVisibility(app: import("../app").MolvisApp, visible: boolean): void {
    app.artist.isosurfaceRenderer.setVisible(visible);
  }

  private pickChannel(frame: Frame): void {
    const channels = DrawIsosurfaceModifier.availableChannels(frame);
    if (channels.length === 0) {
      logger.warn(
        "[DrawIsosurface] frame has no grid columns; rendering will be a no-op",
      );
      return;
    }
    // Preference: density > total > first column. "diff" is signed
    // and only useful in pair-rendering, so it's never the default.
    const preference = ["density", "total"];
    const chosen = preference.find((p) => channels.includes(p)) ?? channels[0];
    this._style = {
      ...this._style,
      channel: chosen,
      // Signed channels: default to ±iso pair so users see both lobes
      // (orbital wavefunctions, magnetization difference).
      showNegative: channelIsSigned(chosen),
    };
  }

  private pickIsovalue(frame: Frame): void {
    const grid = frame.getBlock("grid");
    if (!grid) return;
    const data = grid.copyColF(this._style.channel);
    if (!data) return;
    try {
      const iso = defaultIsovalueFor(this._style.channel, data);
      // Guard against a zero-everywhere channel (e.g. blank diff for
      // nospin CHGCAR mistakenly opened as spin); 1e-3 keeps a probe
      // surface visible rather than collapsing the mesh entirely.
      this._style = {
        ...this._style,
        isovalue: iso > 0 ? iso : 1e-3,
      };
      this._isovalueAuto = false; // sticky after first auto-pick
    } finally {
      // copyColF returned a JS-owned typed array (per molrs API); no
      // free needed. Comment kept so future readers don't second-guess.
    }
  }
}
