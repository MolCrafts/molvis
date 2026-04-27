import { Vector3 } from "@babylonjs/core";
import type { Frame } from "@molcrafts/molrs";
import { viewAtomCoords } from "../io/atom_coords";
import { BaseModifier, ModifierCapability } from "../pipeline/modifier";
import type { PipelineContext } from "../pipeline/types";
import { calculateBoundingBox } from "../utils/bbox";
import { logger } from "../utils/logger";

export interface GuideLine {
  points: [number, number, number][];
}

/**
 * SliceModifier — pure data modifier for slicing molecules.
 *
 * Computes visibility mask and guide line geometry, stored on the instance.
 * The Artist reads these properties to update the GPU state.
 * Does NOT mutate the input Frame or touch the scene directly.
 */
export class SliceModifier extends BaseModifier {
  // Defaults
  private _offset = 0;
  private _normal: [number, number, number] = [1, 0, 0];
  private _invert = false;
  private _isSlab = false;
  private _slabThickness = 5.0;
  private _initialized = false;

  // Public state for UI
  public bounds: {
    min: [number, number, number];
    max: [number, number, number];
  } | null = null;

  constructor(id = "slice-default") {
    super(id, "Slice", new Set([ModifierCapability.TransformsData]));
  }

  /**
   * Setters for UI binding
   */
  set offset(v: number) {
    this._offset = v;
  }
  get offset() {
    return this._offset;
  }

  set normal(v: [number, number, number]) {
    this._normal = v;
  }
  get normal() {
    return this._normal;
  }

  set invert(v: boolean) {
    this._invert = v;
  }
  get invert() {
    return this._invert;
  }

  set isSlab(v: boolean) {
    this._isSlab = v;
  }
  get isSlab() {
    return this._isSlab;
  }

  set slabThickness(v: number) {
    this._slabThickness = v;
  }
  get slabThickness() {
    return this._slabThickness;
  }

  /**
   * Cache key includes parameters
   */
  getCacheKey(): string {
    return `${super.getCacheKey()}:${this._offset}:${this._normal.join(",")}:${this._invert}:${this._isSlab}:${this._slabThickness}`;
  }

  /**
   * Main Compute Function (Synchronous)
   */
  apply(input: Frame, _context: PipelineContext): Frame {
    logger.info(`SliceModifier.apply: start. offset=${this._offset}`);
    // 1. Validation (Strict)
    const atomsBlock = input.getBlock("atoms");
    if (!atomsBlock) {
      logger.warn("SliceModifier: No atoms block found");
      return input;
    }

    const coords = viewAtomCoords(atomsBlock);
    const xCol = coords?.x;
    const yCol = coords?.y;
    const zCol = coords?.z;

    if (!xCol || !yCol || !zCol) {
      logger.warn(
        "SliceModifier: Missing x/y/z and xu/yu/zu coordinate columns",
      );
      return input;
    }

    // 2. Compute Bounding Box (Raw)
    const rawBox = calculateBoundingBox(input);
    if (!rawBox) {
      return input;
    }
    this.bounds = rawBox;

    // --- Auto-Initialization Logic ---
    if (!this._initialized) {
      const { min, max } = rawBox;
      // 1. Center Offset
      const cx = (min[0] + max[0]) / 2;
      const cy = (min[1] + max[1]) / 2;
      const cz = (min[2] + max[2]) / 2;

      // Normalize normal
      let len = Math.sqrt(
        this._normal[0] ** 2 + this._normal[1] ** 2 + this._normal[2] ** 2,
      );
      if (len < 1e-6) len = 1;
      const nx = this._normal[0] / len;
      const ny = this._normal[1] / len;
      const nz = this._normal[2] / len;

      this._offset = cx * nx + cy * ny + cz * nz;

      // 2. Dynamic Thickness (10% of diagonal, rounded up)
      const dx = max[0] - min[0];
      const dy = max[1] - min[1];
      const dz = max[2] - min[2];
      const diag = Math.sqrt(dx * dx + dy * dy + dz * dz);

      this._slabThickness = Math.ceil(diag * 0.1);

      this._initialized = true;
      logger.info(
        `SliceModifier: Auto-initialized. Offset=${this._offset}, Thickness=${this._slabThickness}`,
      );
    }

    // Apply 110% Scale (from center) for Visualization
    const { min, max } = rawBox;
    const cx = (min[0] + max[0]) / 2;
    const cy = (min[1] + max[1]) / 2;
    const cz = (min[2] + max[2]) / 2;

    const w = max[0] - min[0];
    const h = max[1] - min[1];
    const d = max[2] - min[2];

    // 1.1x Scaling
    const scaledBox = {
      min: [cx - w * 0.55, cy - h * 0.55, cz - d * 0.55] as [
        number,
        number,
        number,
      ],
      max: [cx + w * 0.55, cy + h * 0.55, cz + d * 0.55] as [
        number,
        number,
        number,
      ],
    };

    // 3. Compute Visibility (stored on this.visibilityMask)
    this.updateVisibility(xCol, yCol, zCol);

    // 4. Compute visual guide lines (stored on this.guideLines)
    this.computeGuideLines(scaledBox);

    return input;
  }

  public visibilityMask: boolean[] | null = null;
  public guideLines: GuideLine[] = [];

  /**
   * Compute visibility logic.
   */
  private updateVisibility(x: Float64Array, y: Float64Array, z: Float64Array) {
    const count = x.length;
    this.visibilityMask = new Array(count);

    // Normalize plane parameters
    let len = Math.sqrt(
      this._normal[0] ** 2 + this._normal[1] ** 2 + this._normal[2] ** 2,
    );
    if (len < 1e-6) len = 1;
    const nx = this._normal[0] / len;
    const ny = this._normal[1] / len;
    const nz = this._normal[2] / len;
    const offset = this._offset;

    for (let i = 0; i < count; i++) {
      const dist = x[i] * nx + y[i] * ny + z[i] * nz - offset;
      let visible = true;
      if (this._isSlab) {
        visible = Math.abs(dist) <= this._slabThickness / 2;
      } else {
        visible = dist > 0;
      }
      if (this._invert) visible = !visible;
      this.visibilityMask[i] = visible;
    }
  }

  /**
   * Compute visual guide wireframe lines and store on this.guideLines.
   * The Artist reads guideLines from the modifier instance.
   */
  private computeGuideLines(box: {
    min: [number, number, number];
    max: [number, number, number];
  }) {
    const { min, max } = box;

    const MIN_DIM = 2.0;
    const centerBox = [
      (min[0] + max[0]) / 2,
      (min[1] + max[1]) / 2,
      (min[2] + max[2]) / 2,
    ];
    const halfSize = [
      Math.max((max[0] - min[0]) / 2, MIN_DIM / 2),
      Math.max((max[1] - min[1]) / 2, MIN_DIM / 2),
      Math.max((max[2] - min[2]) / 2, MIN_DIM / 2),
    ];

    const corners = [
      new Vector3(
        centerBox[0] - halfSize[0],
        centerBox[1] - halfSize[1],
        centerBox[2] - halfSize[2],
      ),
      new Vector3(
        centerBox[0] + halfSize[0],
        centerBox[1] - halfSize[1],
        centerBox[2] - halfSize[2],
      ),
      new Vector3(
        centerBox[0] - halfSize[0],
        centerBox[1] + halfSize[1],
        centerBox[2] - halfSize[2],
      ),
      new Vector3(
        centerBox[0] + halfSize[0],
        centerBox[1] + halfSize[1],
        centerBox[2] - halfSize[2],
      ),
      new Vector3(
        centerBox[0] - halfSize[0],
        centerBox[1] - halfSize[1],
        centerBox[2] + halfSize[2],
      ),
      new Vector3(
        centerBox[0] + halfSize[0],
        centerBox[1] - halfSize[1],
        centerBox[2] + halfSize[2],
      ),
      new Vector3(
        centerBox[0] - halfSize[0],
        centerBox[1] + halfSize[1],
        centerBox[2] + halfSize[2],
      ),
      new Vector3(
        centerBox[0] + halfSize[0],
        centerBox[1] + halfSize[1],
        centerBox[2] + halfSize[2],
      ),
    ];

    let len = Math.sqrt(
      this._normal[0] ** 2 + this._normal[1] ** 2 + this._normal[2] ** 2,
    );
    if (len < 1e-6) len = 1;
    const nx = this._normal[0] / len;
    const ny = this._normal[1] / len;
    const nz = this._normal[2] / len;
    const n = new Vector3(nx, ny, nz);

    let up = new Vector3(0, 1, 0);
    if (Math.abs(ny) > 0.9) {
      up = new Vector3(0, 0, 1);
    }

    const u = Vector3.Cross(up, n).normalize();
    const v = Vector3.Cross(n, u).normalize();

    let minU = Number.POSITIVE_INFINITY;
    let maxU = Number.NEGATIVE_INFINITY;
    let minV = Number.POSITIVE_INFINITY;
    let maxV = Number.NEGATIVE_INFINITY;

    for (const p of corners) {
      const dotU = Vector3.Dot(p, u);
      const dotV = Vector3.Dot(p, v);
      if (dotU < minU) minU = dotU;
      if (dotU > maxU) maxU = dotU;
      if (dotV < minV) minV = dotV;
      if (dotV > maxV) maxV = dotV;
    }

    const lines: GuideLine[] = [];

    const addRect = (planeD: number) => {
      const center = n.scale(planeD);
      const p0 = center.add(u.scale(minU)).add(v.scale(minV));
      const p1 = center.add(u.scale(maxU)).add(v.scale(minV));
      const p2 = center.add(u.scale(maxU)).add(v.scale(maxV));
      const p3 = center.add(u.scale(minU)).add(v.scale(maxV));

      for (const [a, b] of [
        [p0, p1],
        [p1, p2],
        [p2, p3],
        [p3, p0],
      ]) {
        lines.push({
          points: [
            [a.x, a.y, a.z],
            [b.x, b.y, b.z],
          ],
        });
      }
    };

    if (this._isSlab) {
      addRect(this._offset - this._slabThickness / 2);
      addRect(this._offset + this._slabThickness / 2);
    } else {
      addRect(this._offset);
    }

    this.guideLines = lines;
  }
}
