import { type Frame, RDF as WasmRDF } from "@molcrafts/molvis-core/molrs";
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
 * Dummy volume handed to WASM when only pair counts are needed.
 * Normalization of g(r) is discarded in that path.
 */
const DUMMY_VOLUME_FOR_COUNTS = 1;

/**
 * Compute a radial pair histogram and present it as g(r), p(r), or ρ(r).
 *
 * **Single path:** molrs `RDF.compute(frame)` streams pairs through a
 * cell-list index (`build_index` + `visit_pairs`) — a full NeighborList is
 * never materialised. Memory is O(N + nBins), not O(P).
 *
 * Group selection:
 * - groupA only → self-histogram within groupA
 * - groupA + groupB → cross-histogram between groupA and groupB
 */
export function computeRdf(
  frame: Frame,
  params: RdfParams = {},
): RdfResult | null {
  const atoms = frame.getBlock("atoms");
  if (!atoms) return null;
  if (atoms.nrows() < 2) return null;

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
    volumeOverride: volumePlan.wasmVolume,
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

    if (isSelf && groupA.length === atoms.nrows()) {
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
  /** Value passed to WASM constructor (always a positive number or null=box). */
  wasmVolume: number | null;
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
    return { wasmVolume: paramVolume, hasReferenceVolume: true };
  }
  if (frame.box) {
    return { wasmVolume: null, hasReferenceVolume: true };
  }
  if (needsGr) {
    throw new Error(
      "Pair distribution: RDF g(r) needs a reference volume — pass volume (Å³) or choose pair distribution / radial density",
    );
  }
  // Pair / density only need counts; feed a dummy volume to WASM.
  return {
    wasmVolume: DUMMY_VOLUME_FOR_COUNTS,
    hasReferenceVolume: false,
  };
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

/**
 * Run the single molrs RDF API: `new RDF(...).compute(frame)` which streams
 * pairs (no NeighborList). Optional `queryFrame` selects the cross path.
 */
function runWasmRdf(
  frame: Frame,
  opts: RdfRunOpts,
  queryFrame?: Frame,
): RdfResult {
  let rdfObj: WasmRDF | null = null;
  try {
    rdfObj = new WasmRDF(opts.nBins, opts.rMax, opts.rMin, opts.volumeOverride);
    // Streaming API: self = compute(frame); cross = computeCross(ref, query).
    const wasmResult = queryFrame
      ? rdfObj.computeCross(frame, queryFrame)
      : rdfObj.compute(frame);
    const grRaw = new Float64Array(wasmResult.rdf());
    const counts = new Float64Array(wasmResult.pairCounts());
    const nParticles = wasmResult.numPoints;
    const volumeRaw = wasmResult.volume;
    const dr = (opts.rMax - opts.rMin) / opts.nBins;
    const r = new Float64Array(opts.nBins);
    for (let i = 0; i < opts.nBins; i++) {
      r[i] = opts.rMin + (i + 0.5) * dr;
    }
    wasmResult.free();

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
    rdfObj?.free();
  }
}

/** Full-frame self-histogram (streaming cell index). */
function computeFullRdf(frame: Frame, opts: RdfRunOpts): RdfResult {
  return runWasmRdf(frame, opts);
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

/** Cross-histogram between two groups (streaming cell index on ref, visit query). */
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

  try {
    return runWasmRdf(refFrame, opts, queryFrame);
  } finally {
    refFrame.free();
    queryFrame.free();
  }
}
