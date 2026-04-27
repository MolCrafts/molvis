import { Color3 } from "@babylonjs/core";
import type { Block } from "@molcrafts/molrs";
import { viewAtomCoords } from "../io/atom_coords";
import {
  COLOR_OVERRIDE_B,
  COLOR_OVERRIDE_G,
  COLOR_OVERRIDE_R,
} from "../modifiers/ColorByPropertyModifier";
import { encodePickingColorInto } from "../picker";
import { DType } from "../utils/dtype";
import { type LinearRGB, buildCategoricalColorLookup } from "./palette";
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
 * When __color_r/g/b override columns are present (injected by
 * ColorByPropertyModifier), uses them instead of element/type colors.
 * Radius is always resolved from the style system.
 */
export function buildAtomBuffers(
  atomsBlock: Block,
  styleManager: StyleManager,
  atomMeshUniqueId: number,
  options?: AtomBufferOptions,
): Map<string, Float32Array> {
  const atomCount = atomsBlock.nrows();
  const coords = viewAtomCoords(atomsBlock);
  const xCoords = coords?.x;
  const yCoords = coords?.y;
  const zCoords = coords?.z;

  // Canonical: `element` is String. Secondary: `type` as stringified numeric
  // category for LAMMPS dumps/data that carry no element symbol. These are
  // the only two sources the renderer reads — no other column names.
  const elementsColumn =
    atomsBlock.dtype("element") === DType.String
      ? (atomsBlock.copyColStr("element") as string[])
      : undefined;
  const typesColumn = elementsColumn
    ? undefined
    : readTypeAsStrings(atomsBlock);

  if (!xCoords || !yCoords || !zCoords)
    throw new Error("No coordinates column");

  // Check for color override columns from ColorByPropertyModifier
  const overrideR = atomsBlock.dtype(COLOR_OVERRIDE_R)
    ? atomsBlock.viewColF(COLOR_OVERRIDE_R)
    : undefined;
  const overrideG = atomsBlock.dtype(COLOR_OVERRIDE_G)
    ? atomsBlock.viewColF(COLOR_OVERRIDE_G)
    : undefined;
  const overrideB = atomsBlock.dtype(COLOR_OVERRIDE_B)
    ? atomsBlock.viewColF(COLOR_OVERRIDE_B)
    : undefined;
  const hasColorOverride = overrideR && overrideG && overrideB;

  const atomMatrix = new Float32Array(atomCount * 16);
  const atomData = new Float32Array(atomCount * 4);
  const atomColor = new Float32Array(atomCount * 4);
  const atomPick = new Float32Array(atomCount * 4);

  const styleCache = new Map<string, CachedAtomStyle>();
  const typeColorLookup =
    !elementsColumn && typesColumn
      ? buildCategoricalColorLookup(typesColumn.map((type) => type ?? "UNK"))
      : null;
  const customRadii = options?.radii;
  const radiusScale = options?.radiusScale ?? 1.0;
  const visibleArr = options?.visible;

  for (let i = 0; i < atomCount; i++) {
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
    const matOffset = i * 16;
    const idx4 = i * 4;

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
  }

  const buffers = new Map<string, Float32Array>();
  buffers.set("matrix", atomMatrix);
  buffers.set("instanceData", atomData);
  buffers.set("instanceColor", atomColor);
  buffers.set("instancePickingColor", atomPick);
  return buffers;
}

/**
 * Build only the per-atom RGBA color buffer. Used by the bond
 * draw path when the atom layer hasn't been registered yet
 * (e.g. user disabled `DrawAtomModifier` but kept `DrawBondModifier`),
 * so the bond bicolor pass still has a per-atom color source without
 * paying the matrix / instanceData / picking allocations.
 */
export function buildAtomColorOnly(
  atomsBlock: Block,
  styleManager: StyleManager,
): Float32Array {
  const atomCount = atomsBlock.nrows();
  const elementsColumn =
    atomsBlock.dtype("element") === DType.String
      ? (atomsBlock.copyColStr("element") as string[])
      : undefined;
  const typesColumn = elementsColumn
    ? undefined
    : readTypeAsStrings(atomsBlock);

  const overrideR = atomsBlock.dtype(COLOR_OVERRIDE_R)
    ? atomsBlock.viewColF(COLOR_OVERRIDE_R)
    : undefined;
  const overrideG = atomsBlock.dtype(COLOR_OVERRIDE_G)
    ? atomsBlock.viewColF(COLOR_OVERRIDE_G)
    : undefined;
  const overrideB = atomsBlock.dtype(COLOR_OVERRIDE_B)
    ? atomsBlock.viewColF(COLOR_OVERRIDE_B)
    : undefined;
  const hasColorOverride = overrideR && overrideG && overrideB;

  const out = new Float32Array(atomCount * 4);
  const styleCache = new Map<string, CachedAtomStyle>();
  const typeColorLookup =
    !elementsColumn && typesColumn
      ? buildCategoricalColorLookup(typesColumn.map((t) => t ?? "UNK"))
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

/**
 * Read the `type` column as stringified category keys (e.g. "1", "2"). LAMMPS
 * dumps emit `type` as I32, LAMMPS data as I64; both are palette-keyed by
 * their string form. Returns undefined when `type` is absent.
 */
function readTypeAsStrings(block: Block): string[] | undefined {
  const dt = block.dtype("type");
  if (dt === DType.I32) {
    return Array.from(block.copyColI32("type"), (v) => String(v));
  }
  if (dt === DType.U32) {
    return Array.from(block.copyColU32("type"), (v) => String(v));
  }
  if (dt === DType.String) {
    return block.copyColStr("type") as string[];
  }
  return undefined;
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
