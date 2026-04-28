import {
  Block,
  type Frame,
  Frame as FrameClass,
  LinkedCell,
  RDF as WasmRDF,
} from "@molcrafts/molrs";
import { viewAtomCoords } from "../io/atom_coords";
import { estimateRMax } from "./utils";

export interface RdfParams {
  /** Maximum distance cutoff. Auto-detected from box or bounding box if not set. */
  rMax?: number;
  /**
   * Lower radial cutoff. Defaults to 0 (freud convention). Pairs with
   * `d < rMin` and pairs at exactly `d == 0` are excluded.
   */
  rMin?: number;
  /** Number of bins (default 100) */
  nBins?: number;
  /** Indices of atoms to include (default: all atoms). When only groupA is set, computes self-RDF. */
  groupA?: number[];
  /** Indices for cross-RDF second group. If omitted, uses groupA (self-RDF). */
  groupB?: number[];
  /**
   * Normalization volume in Å³. Required for non-periodic frames (no simbox).
   * For periodic frames, overrides the box volume if provided.
   */
  volume?: number;
}

export interface RdfResult {
  /** Bin center distances */
  r: Float64Array;
  /** g(r) values */
  gr: Float64Array;
  /** Raw pair counts per bin */
  counts: Float64Array;
  /** Number of bins */
  nBins: number;
  /** Bin width */
  dr: number;
  /** Upper cutoff used */
  rMax: number;
  /** Lower cutoff used */
  rMin: number;
  /** Number of reference particles used */
  nParticles: number;
  /** Normalization volume used (Å³). */
  volume: number;
}

const DEFAULT_N_BINS = 100;
const DEFAULT_R_MIN = 0;

/**
 * Compute the radial distribution function g(r) from a single frame.
 *
 * Follows freud defaults: `nBins = 100`, `rMin = 0`, normalize by the
 * system density `N/V`. Periodic frames take their volume from `frame.simbox`.
 * Non-periodic frames (no simbox) require the caller to pass `volume`
 * explicitly — no bounding box is fabricated.
 *
 * Group selection:
 * - groupA only → self-RDF within groupA
 * - groupA + groupB → cross-RDF between groupA and groupB
 */
export function computeRdf(
  frame: Frame,
  params: RdfParams = {},
): RdfResult | null {
  const atoms = frame.getBlock("atoms");
  if (!atoms) return null;
  if (atoms.nrows() < 2) return null;

  const nBins = params.nBins ?? DEFAULT_N_BINS;
  const rMin = params.rMin ?? DEFAULT_R_MIN;
  const rMax = params.rMax ?? estimateRMax(frame);
  if (!(rMax > rMin)) {
    throw new Error(`RDF: rMax (${rMax}) must be > rMin (${rMin})`);
  }

  const opts: RdfRunOpts = {
    nBins,
    rMax,
    rMin,
    volumeOverride: resolveVolume(frame, params.volume),
  };

  const groupA = params.groupA;
  const groupB = params.groupB;
  const hasGroups = groupA && groupA.length > 0;

  if (!hasGroups) {
    return computeFullRdf(frame, opts);
  }

  const effectiveB = groupB ?? groupA;
  const isSelf =
    groupA === effectiveB ||
    (groupA.length === effectiveB.length &&
      groupA.every((v, i) => v === effectiveB[i]));

  if (isSelf) {
    return computeSelfGroupRdf(frame, groupA, opts);
  }
  return computeCrossGroupRdf(frame, groupA, effectiveB, opts);
}

interface RdfRunOpts {
  nBins: number;
  rMax: number;
  rMin: number;
  volumeOverride: number | null;
}

/** Returns the explicit volume, or null to defer to `frame.simbox`. Throws if neither is available or the explicit value is invalid. */
function resolveVolume(
  frame: Frame,
  paramVolume: number | undefined,
): number | null {
  if (paramVolume !== undefined) {
    if (!Number.isFinite(paramVolume) || paramVolume <= 0) {
      throw new Error(
        `RDF: volume must be a finite positive number, got ${paramVolume}`,
      );
    }
    return paramVolume;
  }
  if (!frame.simbox) {
    throw new Error(
      "RDF: frame has no simulation box — pass an explicit `volume` (Å³)",
    );
  }
  return null;
}

/** `volumeFrame` is only consulted when `opts.volumeOverride` is null. */
function runWasmRdf(
  volumeFrame: Frame,
  nlist: ReturnType<LinkedCell["build"]>,
  opts: RdfRunOpts,
): RdfResult {
  let rdfObj: WasmRDF | null = null;
  try {
    rdfObj = new WasmRDF(opts.nBins, opts.rMax, opts.rMin);
    const wasmResult =
      opts.volumeOverride !== null
        ? rdfObj.computeWithVolume(nlist, opts.volumeOverride)
        : rdfObj.compute(volumeFrame, nlist);
    const gr = wasmResult.rdf();
    const counts = wasmResult.pairCounts();
    const nParticles = wasmResult.numPoints;
    const volume = wasmResult.volume;
    const dr = (opts.rMax - opts.rMin) / opts.nBins;
    // Bin centers are closed-form in (rMin, dr, i) — compute in JS
    // and skip the WASM round-trip. Float64 to match the rest of the
    // molvis numeric stack (atom xyz, box h-matrix, copyColF).
    const r = new Float64Array(opts.nBins);
    for (let i = 0; i < opts.nBins; i++) {
      r[i] = opts.rMin + (i + 0.5) * dr;
    }
    wasmResult.free();
    return {
      r,
      gr,
      counts,
      nBins: opts.nBins,
      dr,
      rMax: opts.rMax,
      rMin: opts.rMin,
      nParticles,
      volume,
    };
  } finally {
    rdfObj?.free();
  }
}

/** Full-frame RDF via LinkedCell.build (self-query, unique pairs). */
function computeFullRdf(frame: Frame, opts: RdfRunOpts): RdfResult {
  const lc = new LinkedCell(opts.rMax);
  const nlist = lc.build(frame);
  try {
    return runWasmRdf(frame, nlist, opts);
  } finally {
    nlist.free();
    lc.free();
  }
}

/** Self-RDF for a subset of atoms. */
function computeSelfGroupRdf(
  frame: Frame,
  group: number[],
  opts: RdfRunOpts,
): RdfResult | null {
  if (group.length < 2) return null;
  const subFrame = buildSubFrame(frame, group);
  if (!subFrame) return null;
  try {
    return computeFullRdf(subFrame, opts);
  } finally {
    subFrame.free();
  }
}

/** Cross-RDF between two groups via LinkedCell.query. */
function computeCrossGroupRdf(
  frame: Frame,
  groupA: number[],
  groupB: number[],
  opts: RdfRunOpts,
): RdfResult | null {
  if (groupA.length < 1 || groupB.length < 1) return null;

  const refFrame = buildSubFrame(frame, groupA);
  const queryFrame = buildSubFrame(frame, groupB);
  if (!refFrame || !queryFrame) {
    refFrame?.free();
    queryFrame?.free();
    return null;
  }

  const lc = new LinkedCell(opts.rMax);
  const nlist = lc.query(refFrame, queryFrame);
  try {
    return runWasmRdf(refFrame, nlist, opts);
  } finally {
    nlist.free();
    lc.free();
    refFrame.free();
    queryFrame.free();
  }
}

/**
 * Build a sub-frame containing only the selected atom indices.
 * Copies simbox from the original frame if present.
 */
function buildSubFrame(frame: Frame, indices: number[]): Frame | null {
  const atoms = frame.getBlock("atoms");
  if (!atoms) return null;

  const coords = viewAtomCoords(atoms);
  const x = coords?.x;
  const y = coords?.y;
  const z = coords?.z;
  if (!x || !y || !z) return null;

  const n = indices.length;
  const sx = new Float64Array(n);
  const sy = new Float64Array(n);
  const sz = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    sx[i] = x[indices[i]];
    sy[i] = y[indices[i]];
    sz[i] = z[indices[i]];
  }

  const subBlock = new Block();
  subBlock.setColF("x", sx);
  subBlock.setColF("y", sy);
  subBlock.setColF("z", sz);

  const elems = atoms.copyColStr("element");
  if (elems) {
    subBlock.setColStr(
      "element",
      indices.map((i) => elems[i]),
    );
  }

  const subFrame = new FrameClass();
  subFrame.insertBlock("atoms", subBlock);

  // Copy simbox so LinkedCell uses periodic boundaries when present.
  const simbox = frame.simbox;
  if (simbox) {
    subFrame.simbox = simbox;
  }

  return subFrame;
}
