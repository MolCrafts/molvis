/**
 * Pure PBC wrap helpers shared by {@link WrapPBCModifier} and the pipeline
 * coordinate-policy step.
 */

import { type Box, WasmArray } from "@molcrafts/molvis-core/molrs";

type BondView = {
  nrows(): number;
  viewColU32(key: string): Uint32Array | undefined;
};

/**
 * Wrap each atom independently into the primary cell (ignore bonds).
 */
export function wrapAtoms(
  box: Box,
  x: Float64Array,
  y: Float64Array,
  z: Float64Array,
  atomCount: number,
): { x: Float64Array; y: Float64Array; z: Float64Array } {
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
  const outX = new Float64Array(atomCount);
  const outY = new Float64Array(atomCount);
  const outZ = new Float64Array(atomCount);
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

/**
 * Union-find components over the bond graph, then wrap each component as
 * a rigid image (reference atom + minimum-image offsets).
 * Isolated atoms (no bonds) wrap alone — same as {@link wrapAtoms}.
 */
export function wrapMolecules(
  box: Box,
  x: Float64Array,
  y: Float64Array,
  z: Float64Array,
  atomCount: number,
  bonds: BondView | undefined,
): { x: Float64Array; y: Float64Array; z: Float64Array } {
  const parent = new Int32Array(atomCount);
  for (let i = 0; i < atomCount; i++) parent[i] = i;

  const find = (i: number): number => {
    let r = i;
    while (parent[r] !== r) r = parent[r];
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

  // Fast path: every atom is its own component.
  if (groups.size === atomCount) {
    return wrapAtoms(box, x, y, z, atomCount);
  }

  const outX = new Float64Array(atomCount);
  const outY = new Float64Array(atomCount);
  const outZ = new Float64Array(atomCount);
  for (const members of groups.values()) {
    wrapComponent(box, members, x, y, z, outX, outY, outZ);
  }
  return { x: outX, y: outY, z: outZ };
}

/** @deprecated Use {@link wrapMolecules} — kept for call-site renames. */
export const wrapMoleculeAware = wrapMolecules;

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
