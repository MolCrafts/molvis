import { type Frame, Rdf as WasmRDF } from "@molcrafts/molvis-core/molrs";
import { buildAtomSubFrame } from "./frame_subset";
import {
  type RdfParams,
  type RdfResult,
  type ResolvedPairRepresentation,
  representationYLabel,
  resolvePairRepresentation,
} from "./rdf_params";
import { estimateRMax } from "./utils";

const DEFAULT_N_BINS = 100;
const DEFAULT_R_MIN = 0;

/**
 * Compute a radial pair histogram and present it as g(r), p(r), or ρ(r).
 *
 * **Single path:** molrs `Rdf.compute([{ pairs }])` bins a neighbor table
 * built with cutoff `rMax` — a self query for one group, a cross query
 * (`NeighborQuery`) between two.
 *
 * Group selection:
 * - groupA only → self-histogram within groupA
 * - groupA + groupB → cross-histogram between groupA and groupB
 */
export function computeRdf(
  frame: Frame,
  params: RdfParams = {},
): RdfResult | null {
  const atoms = frame.has("atoms") ? frame.get("atoms") : undefined;
  if (!atoms) return null;
  if (atoms.nRows < 2) return null;

  const representation = resolvePairRepresentation(
    frame,
    params.representation ?? "auto",
  );
  const rMin = params.rMin ?? DEFAULT_R_MIN;
  const rMax = params.rMax ?? estimateRMax(frame);
  if (!(Number.isFinite(rMax) && rMax > rMin && rMax > 0)) {
    throw new Error(
      `Pair distribution: rMax (${rMax}) must be a finite number > rMin (${rMin}) and > 0`,
    );
  }
  if (!(Number.isFinite(rMin) && rMin >= 0)) {
    throw new Error(
      `Pair distribution: rMin (${rMin}) must be a finite number ≥ 0`,
    );
  }

  const nBins = params.nBins ?? DEFAULT_N_BINS;
  if (!(Number.isFinite(nBins) && nBins >= 1)) {
    throw new Error(`Pair distribution: nBins (${nBins}) must be ≥ 1`);
  }

  const needsGr = representation === "gr";
  const volumePlan = resolveVolume(frame, params.volume, needsGr);
  const opts: RdfRunOpts = {
    nBins,
    rMax,
    rMin,
    volumeOverride: volumePlan.override,
    hasReferenceVolume: volumePlan.hasReferenceVolume,
    representation,
  };

  const groupA = params.groupA;
  const groupB = params.groupB;
  const hasGroups = groupA && groupA.length > 0;

  try {
    if (!hasGroups) {
      return computeFullRdf(frame, opts);
    }

    const effectiveB = groupB ?? groupA;
    const isSelf =
      groupA === effectiveB ||
      (groupA.length === effectiveB.length &&
        groupA.every((v, i) => v === effectiveB[i]));

    if (isSelf && groupA.length === atoms.nRows) {
      return computeFullRdf(frame, opts);
    }

    if (isSelf) {
      return computeSelfGroupRdf(frame, groupA, opts);
    }
    return computeCrossGroupRdf(frame, groupA, effectiveB, opts);
  } catch (e) {
    throw rethrowWasm(e, "Pair distribution");
  }
}

/** wasm-bindgen turns Rust panics into RuntimeError: unreachable. */
function rethrowWasm(e: unknown, label: string): Error {
  if (typeof e === "string") return new Error(`${label}: ${e}`);
  if (e instanceof Error) {
    if (e.message === "unreachable" || e.name === "RuntimeError") {
      return new Error(
        `${label}: WASM trap (${e.message}). ` +
          `Common causes: invalid/zero box, missing x/y/z columns, or a freed frame handle.`,
        { cause: e },
      );
    }
    return e;
  }
  return new Error(`${label}: ${String(e)}`);
}

interface VolumePlan {
  /**
   * The reference volume g(r) is normalised against, in Å³: the caller's
   * override, else the frame's cell. `null` when there is neither.
   */
  override: number | null;
  hasReferenceVolume: boolean;
}

function resolveVolume(
  frame: Frame,
  paramVolume: number | undefined,
  needsGr: boolean,
): VolumePlan {
  if (paramVolume !== undefined) {
    if (!Number.isFinite(paramVolume) || paramVolume <= 0) {
      throw new Error(
        `Pair distribution: volume must be a finite positive number, got ${paramVolume}`,
      );
    }
    return { override: paramVolume, hasReferenceVolume: true };
  }
  // The cell's own volume, not the neighbor table's: a cell the product treats
  // as non-periodic is searched free-boundary (`SpatialNeighborQuery`), and
  // molrs then normalises against a volume of its own choosing.
  const box = frame.box;
  if (box) {
    try {
      return { override: box.volume(), hasReferenceVolume: true };
    } finally {
      box.free();
    }
  }
  if (needsGr) {
    throw new Error(
      "Pair distribution: RDF g(r) needs a reference volume — pass volume (Å³) or choose pair distribution / radial density",
    );
  }
  // Pair / density only need counts; g(r) is zeroed below.
  return { override: null, hasReferenceVolume: false };
}

interface RdfRunOpts {
  nBins: number;
  rMax: number;
  rMin: number;
  volumeOverride: number | null;
  hasReferenceVolume: boolean;
  representation: ResolvedPairRepresentation;
}

function shellDensity(
  counts: Float64Array,
  r: Float64Array,
  dr: number,
): Float64Array {
  const out = new Float64Array(counts.length);
  for (let i = 0; i < counts.length; i++) {
    const ri = r[i];
    const shell = 4 * Math.PI * ri * ri * dr;
    out[i] = shell > 0 ? counts[i] / shell : 0;
  }
  return out;
}

function pickY(
  rep: ResolvedPairRepresentation,
  gr: Float64Array,
  counts: Float64Array,
  density: Float64Array,
): Float64Array {
  switch (rep) {
    case "gr":
      return gr;
    case "pair":
      return counts;
    case "density":
      return density;
  }
}

/** Self pairs within `rMax` among the atoms of `frame`. Caller frees. */
function selfPairs(frame: Frame, rMax: number): Neighbors {
  const query = new SpatialNeighborQuery(rMax);
  try {
    rdfObj = new WasmRDF(opts.nBins, opts.rMax, opts.rMin, opts.volumeOverride);
    // Streaming API: self = compute(frame); cross = computeCross(ref, query).
    const wasmResult = queryFrame
      ? rdfObj.computeCross(frame, queryFrame)
      : rdfObj.compute(frame);
    const grRaw = new Float64Array(wasmResult.rdf());
    const counts = new Float64Array(wasmResult.pairCounts());
    const nParticles = wasmResult.nPoints;
    const volumeRaw = wasmResult.volume;
    const dr = (opts.rMax - opts.rMin) / opts.nBins;
    const r = new Float64Array(opts.nBins);
    for (let i = 0; i < opts.nBins; i++) {
      r[i] = opts.rMin + (i + 0.5) * dr;
    }

    const hasReferenceVolume = opts.hasReferenceVolume;
    const gr = hasReferenceVolume ? grRaw : new Float64Array(opts.nBins); // zeros — g(r) not meaningful
    const density = shellDensity(counts, r, dr);
    const representation = opts.representation;
    const y = new Float64Array(pickY(representation, gr, counts, density));

    return {
      r,
      y,
      yLabel: representationYLabel(representation),
      representation,
      gr,
      counts,
      density,
      nBins: opts.nBins,
      dr,
      rMax: opts.rMax,
      rMin: opts.rMin,
      nParticles,
      volume: hasReferenceVolume ? volumeRaw : Number.NaN,
      hasReferenceVolume,
    };
  } finally {
    wasmResult?.free();
    rdfObj?.free();
  }
}

/** Full-frame self-histogram (streaming cell index). */
function computeFullRdf(frame: Frame, opts: RdfRunOpts): RdfResult {
  const pairs = selfPairs(frame, opts.rMax);
  try {
    return runWasmRdf(pairs, opts);
  } finally {
    pairs.free();
  }
}

/** Self-histogram for a subset of atoms. */
function computeSelfGroupRdf(
  frame: Frame,
  group: number[],
  opts: RdfRunOpts,
): RdfResult | null {
  if (group.length < 2) return null;
  const subFrame = buildAtomSubFrame(frame, group);
  if (!subFrame) return null;
  try {
    return computeFullRdf(subFrame, opts);
  } finally {
    subFrame.free();
  }
}

/** Cross-histogram between two groups (`NeighborQuery` on ref, query B). */
function computeCrossGroupRdf(
  frame: Frame,
  groupA: number[],
  groupB: number[],
  opts: RdfRunOpts,
): RdfResult | null {
  if (groupA.length < 1 || groupB.length < 1) return null;

  const refFrame = buildAtomSubFrame(frame, groupA);
  const queryFrame = buildAtomSubFrame(frame, groupB);
  if (!refFrame || !queryFrame) {
    refFrame?.free();
    queryFrame?.free();
    return null;
  }

  let pairs: Neighbors | null = null;
  try {
    pairs = crossPairs(refFrame, queryFrame, opts.rMax);
    return runWasmRdf(pairs, opts);
  } finally {
    pairs?.free();
    refFrame.free();
    queryFrame.free();
  }
}
