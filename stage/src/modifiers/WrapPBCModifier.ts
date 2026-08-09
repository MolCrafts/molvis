import { type Box, Frame, WasmArray } from "@molcrafts/molvis-core/molrs";
import { viewAtomCoords } from "../io/atom_coords";
import { shouldDrawBox } from "../io/box_presence";
import { BaseModifier, ModifierCapability } from "../pipeline/modifier";
import type { PipelineContext } from "../pipeline/types";
import { logger } from "../utils/logger";

/**
 * WrapPBC wraps atom coordinates into the primary cell.
 *
 * **Molecule-aware**: atoms connected by bonds (topology) share one lattice
 * image. A reference atom of each connected component is wrapped into the
 * primary cell; every other atom in the molecule is placed at
 * `wrap(ref) + MI(atom − ref)` so covalent structure stays intact and bonds
 * do not stretch across the box. Isolated atoms (no bonds) wrap alone.
 *
 * Requires a **usable** `frame.box` (non-zero edges). Having a box does
 * **not** enable this modifier — it is never auto-attached; the user
 * opts in. Zero-size cells are treated as no box.
 */
export class WrapPBCModifier extends BaseModifier {
  constructor(id: string) {
    super(id, "Wrap PBC", new Set([ModifierCapability.TransformsData]));
  }

  /** Never auto-attach. Box present ≠ wrap. */
  matches(_frame: Frame): boolean {
    return false;
  }

  isApplicable(frame: Frame): boolean {
    return shouldDrawBox(frame.box);
  }

  apply(input: Frame, _context: PipelineContext): Frame {
    const box = input.box;
    if (!shouldDrawBox(box)) {
      logger.warn("WrapPBC: Frame has no usable box, skipping");
      return input;
    }

    const atoms = input.getBlock("atoms");
    if (!atoms) {
      return input;
    }

    const coords = viewAtomCoords(atoms);
    const x = coords?.x;
    const y = coords?.y;
    const z = coords?.z;
    if (!x || !y || !z) {
      logger.warn("WrapPBC: missing x/y/z and xu/yu/zu columns, skipping");
      return input;
    }

    const atomCount = atoms.nrows();
    if (atomCount === 0) {
      return input;
    }

    const bonds = input.getBlock("bonds");
    const wrapped = wrapMoleculeAware(box, x, y, z, atomCount, bonds);

    const result = new Frame();
    result.insertBlock("atoms", atoms);
    const resultAtoms = result.getBlock("atoms");
    if (!resultAtoms) {
      throw new Error("WrapPBC: failed to clone atoms block");
    }

    resultAtoms.setColF(coords.columns.x, wrapped.x);
    resultAtoms.setColF(coords.columns.y, wrapped.y);
    resultAtoms.setColF(coords.columns.z, wrapped.z);

    if (bonds) {
      result.insertBlock("bonds", bonds);
    }

    // Preserve other blocks (grid, etc.) if present.
    for (const name of input.blockNames()) {
      if (name === "atoms" || name === "bonds") continue;
      const block = input.getBlock(name);
      if (block) result.insertBlock(name, block);
    }

    result.box = box;
    return result;
  }

  getCacheKey(): string {
    return `${super.getCacheKey()}`;
  }
}

/**
 * Union-find components over the bond graph, then wrap each component as
 * a rigid image (reference atom + minimum-image offsets).
 */
export function wrapMoleculeAware(
  box: Box,
  x: Float64Array,
  y: Float64Array,
  z: Float64Array,
  atomCount: number,
  bonds:
    | { nrows(): number; viewColU32(key: string): Uint32Array | undefined }
    | undefined,
): { x: Float64Array; y: Float64Array; z: Float64Array } {
  const parent = new Int32Array(atomCount);
  for (let i = 0; i < atomCount; i++) parent[i] = i;

  const find = (i: number): number => {
    let r = i;
    while (parent[r] !== r) r = parent[r];
    // path compression
    let c = i;
    while (parent[c] !== c) {
      const next = parent[c];
      parent[c] = r;
      c = next;
    }
    return r;
  };
  const unite = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };

  if (bonds && bonds.nrows() > 0) {
    const atomi = bonds.viewColU32("atomi");
    const atomj = bonds.viewColU32("atomj");
    if (atomi && atomj) {
      const nb = bonds.nrows();
      for (let b = 0; b < nb; b++) {
        const i = atomi[b];
        const j = atomj[b];
        if (i >= 0 && i < atomCount && j >= 0 && j < atomCount) {
          unite(i, j);
        }
      }
    }
  }

  const groups = new Map<number, number[]>();
  for (let i = 0; i < atomCount; i++) {
    const r = find(i);
    const g = groups.get(r);
    if (g) g.push(i);
    else groups.set(r, [i]);
  }

  const outX = new Float64Array(atomCount);
  const outY = new Float64Array(atomCount);
  const outZ = new Float64Array(atomCount);

  // Fast path: every atom is its own component → batch wrap like before.
  if (groups.size === atomCount) {
    const interleaved = new Float64Array(atomCount * 3);
    for (let i = 0; i < atomCount; i++) {
      const i3 = i * 3;
      interleaved[i3] = x[i];
      interleaved[i3 + 1] = y[i];
      interleaved[i3 + 2] = z[i];
    }
    const coordsArr = WasmArray.from(
      interleaved,
      new Uint32Array([atomCount, 3]),
    );
    try {
      const wrapped = box.wrap(coordsArr);
      try {
        const w = wrapped.toCopy();
        for (let i = 0; i < atomCount; i++) {
          const i3 = i * 3;
          outX[i] = w[i3];
          outY[i] = w[i3 + 1];
          outZ[i] = w[i3 + 2];
        }
      } finally {
        wrapped.free();
      }
    } finally {
      coordsArr.free();
    }
    return { x: outX, y: outY, z: outZ };
  }

  for (const members of groups.values()) {
    wrapComponent(box, members, x, y, z, outX, outY, outZ);
  }
  return { x: outX, y: outY, z: outZ };
}

/**
 * Place `members` into one lattice image: wrap the first atom, then put
 * every other atom at wrap(ref) + MI(pos − ref).
 */
function wrapComponent(
  box: Box,
  members: number[],
  x: Float64Array,
  y: Float64Array,
  z: Float64Array,
  outX: Float64Array,
  outY: Float64Array,
  outZ: Float64Array,
): void {
  const ref = members[0];
  const refArr = WasmArray.from(
    new Float64Array([x[ref], y[ref], z[ref]]),
    new Uint32Array([1, 3]),
  );
  let wrx: number;
  let wry: number;
  let wrz: number;
  try {
    const wrapped = box.wrap(refArr);
    try {
      const w = wrapped.toCopy();
      wrx = w[0];
      wry = w[1];
      wrz = w[2];
    } finally {
      wrapped.free();
    }
  } finally {
    refArr.free();
  }
  outX[ref] = wrx;
  outY[ref] = wry;
  outZ[ref] = wrz;

  if (members.length === 1) return;

  const others = members.slice(1);
  const m = others.length;
  const aFlat = new Float64Array(m * 3);
  const bFlat = new Float64Array(m * 3);
  for (let k = 0; k < m; k++) {
    const i = others[k];
    const o = k * 3;
    aFlat[o] = x[ref];
    aFlat[o + 1] = y[ref];
    aFlat[o + 2] = z[ref];
    bFlat[o] = x[i];
    bFlat[o + 1] = y[i];
    bFlat[o + 2] = z[i];
  }
  const aArr = WasmArray.from(aFlat, new Uint32Array([m, 3]));
  const bArr = WasmArray.from(bFlat, new Uint32Array([m, 3]));
  try {
    const delta = box.delta(aArr, bArr, true);
    try {
      const d = delta.toCopy();
      for (let k = 0; k < m; k++) {
        const i = others[k];
        const o = k * 3;
        outX[i] = wrx + d[o];
        outY[i] = wry + d[o + 1];
        outZ[i] = wrz + d[o + 2];
      }
    } finally {
      delta.free();
    }
  } finally {
    aArr.free();
    bArr.free();
  }
}
