import { Color3 } from "@babylonjs/core";
import type { Block, Frame } from "@molcrafts/molvis-core/molrs";
import { readAtomTypeKeys } from "../atom_type";
import {
  COLOR_OVERRIDE_B,
  COLOR_OVERRIDE_G,
  COLOR_OVERRIDE_R,
} from "../color_override_keys";
import { viewAtomCoords } from "../io/atom_coords";
import { encodePickingColorInto } from "../picker";
import { isMetalElement } from "../system/elements";
import {
  shouldSkipOriginSentinels,
  shouldSkipOriginSentinelsForFrame,
} from "../system/occupancy";
import { buildCategoricalColorLookup, type LinearRGB } from "./palette";
import type { StyleManager } from "./style_manager";

export interface AtomBufferOptions {
  radii?: number[];
  /**
   * Scalar multiplier applied to the resolved radius. Lets callers
   * scale the whole atom layer (e.g. `DrawAtomModifier.radiusScale`)
   * without having to build a per-atom `radii` array. Per-atom `radii`
   * still wins when both are supplied.
   */
  radiusScale?: number;
  visible?: boolean[];
}

interface CachedAtomStyle {
  r: number;
  g: number;
  b: number;
  a: number;
  radius: number;
}

/**
 * Build GPU buffers for all atoms in a frame block.
 * Pure computation — no BabylonJS mesh interaction.
 *
 * When the color-override columns are present (injected by a color modifier;
 * see `../color_override_keys`), uses them instead of element/type colors.
 * Radius is always resolved from the style system.
 */
export interface AtomBufferBuild {
  buffers: Map<string, Float32Array>;
  /** Render instance → original atom row when origin sentinels were dropped. */
  instanceMap?: Uint32Array;
}

export function buildAtomBuffers(
  atomsBlock: Block,
  styleManager: StyleManager,
  atomMeshUniqueId: number,
  options?: AtomBufferOptions,
  /** Owning frame, when known — lets the origin-sentinel scan reuse the
   *  per-frame memo shared with frame_diff / perceive. */
  frame?: Frame,
): AtomBufferBuild {
  const atomCount = atomsBlock.nRows;
  const coords = viewAtomCoords(atomsBlock);
  const xCoords = coords?.x;
  const yCoords = coords?.y;
  const zCoords = coords?.z;

  // Canonical: `element` is String. Secondary: `type` / `type_id` via
  // {@link readAtomTypeKeys} (LAMMPS data/dump write the ordinal as
  // `type_id`). These are the only two sources the renderer reads.
  const elementsColumn =
    atomsBlock.has("element") && atomsBlock.dtype("element") === "string"
      ? (atomsBlock.copy("element") as string[])
      : undefined;
  const typesColumn = elementsColumn ? undefined : readAtomTypeKeys(atomsBlock);

  if (!xCoords || !yCoords || !zCoords)
    throw new Error("No coordinates column");

  // Color-override columns (see ../color_override_keys) beat element/type color.
  const overrideR = atomsBlock.has(COLOR_OVERRIDE_R)
    ? (atomsBlock.view(COLOR_OVERRIDE_R) as Float64Array)
    : undefined;
  const overrideG = atomsBlock.has(COLOR_OVERRIDE_G)
    ? (atomsBlock.view(COLOR_OVERRIDE_G) as Float64Array)
    : undefined;
  const overrideB = atomsBlock.has(COLOR_OVERRIDE_B)
    ? (atomsBlock.view(COLOR_OVERRIDE_B) as Float64Array)
    : undefined;
  const hasColorOverride = overrideR && overrideG && overrideB;

  const atomMatrix = new Float32Array(atomCount * 16);
  const atomData = new Float32Array(atomCount * 4);
  const atomColor = new Float32Array(atomCount * 4);
  // x = normally visible, y = reveal highlight, z = pick while hidden.
  const atomStyle = new Float32Array(atomCount * 4);
  const atomPick = new Float32Array(atomCount * 4);

  const styleCache = new Map<string, CachedAtomStyle>();
  const typeColorLookup =
    !elementsColumn && typesColumn
      ? buildCategoricalColorLookup(
          typesColumn.map((type) => type ?? "UNK"),
          { strategy: styleManager.getCategoricalStrategy() },
        )
      : null;
  const customRadii = options?.radii;
  const radiusScale = options?.radiusScale ?? 1.0;
  const visibleArr = options?.visible;
  const representation = styleManager.getRepresentation();
  const dropSentinels = frame
    ? shouldSkipOriginSentinelsForFrame(
        frame,
        xCoords,
        yCoords,
        zCoords,
        atomCount,
      )
    : shouldSkipOriginSentinels(xCoords, yCoords, zCoords, atomCount);
  const instanceMap = dropSentinels ? new Uint32Array(atomCount) : undefined;
  let written = 0;

  for (let i = 0; i < atomCount; i++) {
    if (
      dropSentinels &&
      xCoords[i] === 0 &&
      yCoords[i] === 0 &&
      zCoords[i] === 0
    ) {
      continue;
    }
    // Always resolve style for radius (and fallback color)
    const style = resolveAtomStyle(
      i,
      elementsColumn,
      typesColumn,
      typeColorLookup,
      styleManager,
      styleCache,
    );

    const radius = (customRadii?.[i] ?? style.radius) * radiusScale;
    const scale = radius * 2;
    const matOffset = written * 16;
    const idx4 = written * 4;

    // Matrix (scale + translation)
    atomMatrix[matOffset + 0] = scale;
    atomMatrix[matOffset + 5] = scale;
    atomMatrix[matOffset + 10] = scale;
    atomMatrix[matOffset + 15] = 1;
    atomMatrix[matOffset + 12] = xCoords[i];
    atomMatrix[matOffset + 13] = yCoords[i];
    atomMatrix[matOffset + 14] = zCoords[i];

    // Instance data (position + radius)
    atomData[idx4 + 0] = xCoords[i];
    atomData[idx4 + 1] = yCoords[i];
    atomData[idx4 + 2] = zCoords[i];
    atomData[idx4 + 3] = radius;

    // Color: use override if present and finite, otherwise fall back to style
    const visible = visibleArr ? visibleArr[i] : true;
    const useOverride = hasColorOverride && Number.isFinite(overrideR[i]);
    if (useOverride) {
      atomColor[idx4 + 0] = overrideR[i];
      atomColor[idx4 + 1] = overrideG[i];
      atomColor[idx4 + 2] = overrideB[i];
      atomColor[idx4 + 3] = visible ? style.a : 0.2;
    } else {
      atomColor[idx4 + 0] = style.r;
      atomColor[idx4 + 1] = style.g;
      atomColor[idx4 + 2] = style.b;
      atomColor[idx4 + 3] = visible ? style.a : 0.2;
    }

    // Picking color (zero-allocation write)
    encodePickingColorInto(atomMeshUniqueId, i, atomPick, idx4);

    atomStyle[idx4] =
      representation.atomVisibility === "all" ||
      representation.atomVisibility === "tube-joints" ||
      representation.atomVisibility === "metal-tube-joints" ||
      (representation.atomVisibility === "metals" &&
        elementsColumn !== undefined &&
        isMetalElement(elementsColumn[i]))
        ? 1
        : 0;
    atomStyle[idx4 + 2] = representation.labels === "skeletal" ? 1 : 0;
    if (instanceMap) instanceMap[written] = i;
    written += 1;
  }

  const buffers = new Map<string, Float32Array>();
  buffers.set("matrix", atomMatrix.subarray(0, written * 16));
  buffers.set("instanceData", atomData.subarray(0, written * 4));
  buffers.set("instanceColor", atomColor.subarray(0, written * 4));
  buffers.set("instanceStyle", atomStyle.subarray(0, written * 4));
  buffers.set("instancePickingColor", atomPick.subarray(0, written * 4));
  return {
    buffers,
    instanceMap: instanceMap?.subarray(0, written),
  };
}

/**
 * Build only the per-atom RGBA color buffer. Used by the bond
 * draw path when the atom layer hasn't been registered yet
 * (e.g. user disabled `DrawAtomModifier` but kept `DrawBondModifier`),
 * so the bond bicolor pass still has a per-atom color source without
 * paying the matrix / instanceData / picking allocations.
 */
/**
 * In-place position refresh for the frame + edit atom segments.
 *
 * Only `instanceData` (xyz, radius) is rewritten and uploaded: the impostor
 * vertex shader reads the sphere centre from `instanceData` and never touches
 * the thin-instance `matrix` (`world0..3`), so the 16-float matrix stays as
 * the full build left it. That keeps the per-frame upload at 4 floats per
 * atom instead of 20 and drops the matrix re-upload entirely.
 */
export function refreshAtomPositions(
  x: ArrayLike<number>,
  y: ArrayLike<number>,
  z: ArrayLike<number>,
  atomState: {
    getTotalCount(): number;
    uploadBuffer(name: string): void;
    buffers: Map<string, { data: Float32Array }>;
  },
): void {
  const dataDesc = atomState.buffers.get("instanceData");
  if (!dataDesc) return;
  const count = Math.min(x.length, atomState.getTotalCount());
  const data = dataDesc.data;
  for (let i = 0; i < count; i++) {
    const o = i * 4;
    data[o] = x[i];
    data[o + 1] = y[i];
    data[o + 2] = z[i];
  }
  atomState.uploadBuffer("instanceData");
}

export function buildAtomColorOnly(
  atomsBlock: Block,
  styleManager: StyleManager,
): Float32Array {
  const atomCount = atomsBlock.nRows;
  const elementsColumn =
    atomsBlock.has("element") && atomsBlock.dtype("element") === "string"
      ? (atomsBlock.copy("element") as string[])
      : undefined;
  const typesColumn = elementsColumn ? undefined : readAtomTypeKeys(atomsBlock);

  const overrideR = atomsBlock.has(COLOR_OVERRIDE_R)
    ? (atomsBlock.view(COLOR_OVERRIDE_R) as Float64Array)
    : undefined;
  const overrideG = atomsBlock.has(COLOR_OVERRIDE_G)
    ? (atomsBlock.view(COLOR_OVERRIDE_G) as Float64Array)
    : undefined;
  const overrideB = atomsBlock.has(COLOR_OVERRIDE_B)
    ? (atomsBlock.view(COLOR_OVERRIDE_B) as Float64Array)
    : undefined;
  const hasColorOverride = overrideR && overrideG && overrideB;

  const out = new Float32Array(atomCount * 4);
  const styleCache = new Map<string, CachedAtomStyle>();
  const typeColorLookup =
    !elementsColumn && typesColumn
      ? buildCategoricalColorLookup(
          typesColumn.map((t) => t ?? "UNK"),
          { strategy: styleManager.getCategoricalStrategy() },
        )
      : null;

  for (let i = 0; i < atomCount; i++) {
    const style = resolveAtomStyle(
      i,
      elementsColumn,
      typesColumn,
      typeColorLookup,
      styleManager,
      styleCache,
    );
    const idx4 = i * 4;
    const useOverride = hasColorOverride && Number.isFinite(overrideR[i]);
    if (useOverride) {
      out[idx4] = overrideR[i];
      out[idx4 + 1] = overrideG[i];
      out[idx4 + 2] = overrideB[i];
    } else {
      out[idx4] = style.r;
      out[idx4 + 1] = style.g;
      out[idx4 + 2] = style.b;
    }
    out[idx4 + 3] = style.a;
  }
  return out;
}

function resolveAtomStyle(
  index: number,
  elementsColumn: string[] | undefined,
  typesColumn: string[] | undefined,
  typeColorLookup: Map<string, LinearRGB> | null,
  styleManager: StyleManager,
  cache: Map<string, CachedAtomStyle>,
): CachedAtomStyle {
  if (elementsColumn) {
    const element = elementsColumn[index];
    let cached = cache.get(element);
    if (!cached) {
      const s = styleManager.getAtomStyle(element);
      const c = Color3.FromHexString(s.color).toLinearSpace();
      cached = { r: c.r, g: c.g, b: c.b, a: s.alpha ?? 1.0, radius: s.radius };
      cache.set(element, cached);
    }
    return cached;
  }

  const type = typesColumn ? typesColumn[index] : "UNK";
  const key = `TYPE:${type}`;
  let cached = cache.get(key);
  if (!cached) {
    const s = styleManager.getTypeStyle(type);
    const datasetColor = typeColorLookup?.get(type);
    const fallback = Color3.FromHexString(s.color).toLinearSpace();
    cached = {
      r: datasetColor?.[0] ?? fallback.r,
      g: datasetColor?.[1] ?? fallback.g,
      b: datasetColor?.[2] ?? fallback.b,
      a: s.alpha ?? 1.0,
      radius: s.radius,
    };
    cache.set(key, cached);
  }
  return cached;
}
