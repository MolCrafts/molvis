/**
 * Run one analysis by its catalog `inputKind` — the data shape its molrs
 * binding consumes — never by its id.
 *
 * molrs is the Rust/WebAssembly (WASM) molecular core this package computes
 * with; its *compute catalog* (`./registry`) publishes, per analysis, the shape
 * of the data its binding takes. Every binding is constructor-configured —
 * `compute` and `fit` take only data — so building one is always
 * `new Ctor(...ctorSlotParams)`. A `call`-slot parameter configures a
 * *different* object this module builds first: the neighbor `cutoff` belongs to
 * `LinkedCell`, `minClusterSize` to `Cluster`, `labelBy` picks the column that
 * becomes a `labels` data argument.
 *
 * The id comparisons left inside a shape ({@link runFrameRadii}) choose *what a
 * binding is fed* — atom labels, a void mask. What a binding's *result* looks
 * like is never decided here: every result leaves through
 * `marshalAnalysisResult` (`./result_marshal`), so what this module answers owns
 * no WASM memory.
 *
 * **Kernel-safe, and that is the reason it is its own module.** Nothing here
 * reaches Babylon (the WebGL engine the stage renders with), the DOM (Document
 * Object Model, the live page), a pipeline modifier or the stage `System`: the
 * dependency set is molrs, `../algo/neighbor_list`, and the analysis modules
 * that are themselves molrs-only (`./panel_inputs`, `./frame_subset`,
 * `./result_marshal`, `./registry` for types, `./analysis_ids`,
 * `./trajectory_runner` for the error class and the accumulate-sink interface
 * {@link CatalogAccumulator} implements). So one frame in, one plain-data
 * payload out — the same computation on the browser main thread (`./dispatch`
 * orchestrates the frame loop) and inside the analysis Web Worker (`./job_runner`
 * dispatches a job's snapshots through it). Main → Kernel is the only direction
 * allowed: importing `./dispatch`, `../system` or `../pipeline` from here would
 * drag the main thread into a worker chunk that has neither.
 *
 * Off every barrel on purpose — see the layer table in `./index.ts`.
 */

import * as molrs from "@molcrafts/molvis-core/molrs";
import { Cluster, type Frame } from "@molcrafts/molvis-core/molrs";
import { SpatialNeighborQuery } from "../algo/neighbor_list";
import {
  VORONOI_DOMAIN_ANALYSIS_ID,
  VORONOI_RADICAL_ANALYSIS_ID,
  VORONOI_VOID_ANALYSIS_ID,
} from "./analysis_ids";
import { buildAtomSubFrame } from "./frame_subset";
import {
  angleTriples,
  atomLabels,
  bondPairs,
  dihedralQuads,
  voidMask,
} from "./panel_inputs";
import type { AnalysisDefinition, AnalysisParamSpec } from "./registry";
import { marshalAnalysisResult } from "./result_marshal";
import {
  AnalysisUnsupportedError,
  type TrajectoryAccumulateSink,
} from "./trajectory_runner";

/**
 * Caller-supplied parameter values for one run, keyed by
 * {@link AnalysisParamSpec.key}. Coerced to the spec's declared kind before it
 * reaches a binding.
 *
 * The declaration lives here, beside {@link coerce}, because both the
 * main-thread panels and the worker's wire reader produce this shape;
 * `./dispatch` re-exports it under its original name, so its public import path
 * is unchanged.
 */
export type AnalysisParamValues = Record<string, number | boolean | string>;

// ---------------------------------------------------------------------------
// Parameter coercion
// ---------------------------------------------------------------------------

/**
 * The molrs binding surface a shape drives: constructor-configured, fed data,
 * freed when the shape is done with it.
 *
 * Structural on purpose — the catalog names the class as a string
 * ({@link AnalysisDefinition.wasmExport}), so there is no one type to import.
 */
export interface WasmAnalysis {
  compute?: (...args: unknown[]) => unknown;
  fit?: (...args: unknown[]) => unknown;
  feed?: (frame: Frame) => void;
  free?: () => void;
}

type WasmCtor = new (...args: unknown[]) => WasmAnalysis;

function wasmClass(name: string): WasmCtor {
  const ctor = (molrs as unknown as Record<string, unknown>)[name];
  if (typeof ctor !== "function") {
    throw new Error(`@molcrafts/molvis-core/molrs does not export ${name}`);
  }
  return ctor as WasmCtor;
}

function numbers(value: number | boolean | string): number[] {
  return String(value)
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => {
      const parsed = Number(part);
      if (!Number.isFinite(parsed)) {
        throw new Error(`"${part}" is not a number`);
      }
      return parsed;
    });
}

function coerce(
  spec: AnalysisParamSpec,
  raw: number | boolean | string | undefined,
): unknown {
  const value = raw ?? spec.default;
  switch (spec.kind) {
    case "int": {
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) {
        throw new Error(`${spec.key}: "${String(value)}" is not an integer`);
      }
      return Math.trunc(parsed);
    }
    case "float": {
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) {
        throw new Error(`${spec.key}: "${String(value)}" is not a number`);
      }
      return parsed;
    }
    case "bool":
      return value === true || value === "true";
    case "select":
      return String(value);
    case "intList":
      return new Uint32Array(numbers(value));
    case "floatList":
      return new Float64Array(numbers(value));
    case "textList":
      return String(value)
        .split(",")
        .map((part) => part.trim())
        .filter((part) => part.length > 0);
  }
}

function ctorArgs(
  definition: AnalysisDefinition,
  params: AnalysisParamValues,
): unknown[] {
  return definition.params
    .filter((spec) => spec.slot === "ctor")
    .map((spec) => coerce(spec, params[spec.key]));
}

function callValue(
  definition: AnalysisDefinition,
  params: AnalysisParamValues,
  key: string,
): unknown {
  const spec = definition.params.find((entry) => entry.key === key);
  if (!spec) throw new Error(`${definition.id}: no parameter named ${key}`);
  return coerce(spec, params[key]);
}

/**
 * A `call`-slot parameter as the number the object it configures takes — a
 * neighbor cutoff, a minimum cluster size, a sampling resolution.
 */
export function callNumber(
  definition: AnalysisDefinition,
  params: AnalysisParamValues,
  key: string,
): number {
  return callValue(definition, params, key) as number;
}

// ---------------------------------------------------------------------------
// Per-frame shapes
// ---------------------------------------------------------------------------

/**
 * Build the binding from its `ctor`-slot parameters, in declaration order.
 *
 * Every molrs binding is constructor-configured: `compute` and `fit` take only
 * data. So this is the whole story — no per-analysis construction table.
 *
 * The binding is the caller's from here on: it holds WASM memory until someone
 * calls `free`, which every shape in this module does in a `finally`.
 */
export function instantiate(
  definition: AnalysisDefinition,
  params: AnalysisParamValues,
): WasmAnalysis {
  const Ctor = wasmClass(definition.wasmExport);
  return new Ctor(...ctorArgs(definition, params));
}

/**
 * The `frameRadii` shape — its Voronoi variants differ only in the extra data
 * argument they take beside the frame (none, atom labels, a void mask).
 */
function runFrameRadii(
  frame: Frame,
  definition: AnalysisDefinition,
  params: AnalysisParamValues,
  selected: readonly number[],
): unknown {
  const instance = instantiate(definition, params);
  try {
    switch (definition.id) {
      case VORONOI_RADICAL_ANALYSIS_ID:
        return marshalAnalysisResult(definition.id, instance.compute?.(frame));
      case VORONOI_DOMAIN_ANALYSIS_ID: {
        const labelBy = callValue(definition, params, "labelBy") as string;
        return marshalAnalysisResult(
          definition.id,
          instance.compute?.(frame, atomLabels(frame, labelBy)),
        );
      }
      case VORONOI_VOID_ANALYSIS_ID: {
        const atomCount = frame.getBlock("atoms")?.nrows() ?? 0;
        return marshalAnalysisResult(
          definition.id,
          instance.compute?.(frame, voidMask(atomCount, selected)),
        );
      }
      default:
        throw new AnalysisUnsupportedError(
          definition.id,
          "unknown frameRadii analysis",
        );
    }
  } finally {
    instance.free?.();
  }
}

/**
 * The `frameGroups` shape — bonded pairs, angle triples or dihedral quads read
 * off the frame's bonds block, picked by what the definition requires.
 */
function runFrameGroups(
  frame: Frame,
  definition: AnalysisDefinition,
  params: AnalysisParamValues,
): unknown {
  const groups = definition.requires.includes("atomTriples")
    ? angleTriples(frame)
    : definition.requires.includes("atomQuads")
      ? dihedralQuads(frame)
      : bondPairs(frame);
  if (groups.length === 0) {
    throw new AnalysisUnsupportedError(
      definition.id,
      "the frame's bonds block yields no atom groups",
    );
  }
  const instance = instantiate(definition, params);
  try {
    return marshalAnalysisResult(
      definition.id,
      instance.compute?.(frame, groups),
    );
  } finally {
    instance.free?.();
  }
}

/**
 * Run one frame through a shape that consumes a single `Frame`.
 *
 * @param frame the frame to analyse — read, never freed; it stays its
 *   trajectory's
 * @param definition the catalog entry, whose `inputKind` picks the shape
 * @param params values for the definition's own parameters; an omitted key
 *   falls back to {@link AnalysisParamSpec.default}
 * @param selected rows of the atoms the caller picked, read by the `frameRadii`
 *   shape alone (it turns them into a void-probe mask); pass an empty array for
 *   "no subset"
 * @returns plain data that owns no WASM memory
 * @throws AnalysisUnsupportedError when `inputKind` is not a per-frame shape,
 *   or when the frame cannot supply what the shape needs
 */
export function runSingleFrame(
  frame: Frame,
  definition: AnalysisDefinition,
  params: AnalysisParamValues,
  selected: readonly number[],
): unknown {
  switch (definition.inputKind) {
    case "frame": {
      const instance = instantiate(definition, params);
      try {
        return marshalAnalysisResult(definition.id, instance.compute?.(frame));
      } finally {
        instance.free?.();
      }
    }
    case "frameNeighbors": {
      const query = new SpatialNeighborQuery(
        callNumber(definition, params, "cutoff"),
      );
      const neighbors = query.build(frame);
      const instance = instantiate(definition, params);
      try {
        return marshalAnalysisResult(
          definition.id,
          instance.compute?.(frame, neighbors),
        );
      } finally {
        instance.free?.();
        neighbors.free();
        query.free();
      }
    }
    case "frameClusters": {
      const query = new SpatialNeighborQuery(
        callNumber(definition, params, "cutoff"),
      );
      const neighbors = query.build(frame);
      const cluster = new Cluster(
        callNumber(definition, params, "minClusterSize"),
      );
      const clusters = cluster.compute(frame, neighbors);
      const instance = instantiate(definition, params);
      try {
        return marshalAnalysisResult(
          definition.id,
          instance.compute?.(frame, clusters),
        );
      } finally {
        instance.free?.();
        clusters.free();
        cluster.free();
        neighbors.free();
        query.free();
      }
    }
    case "frameRadii":
      return runFrameRadii(frame, definition, params, selected);
    case "frameGroups":
      return runFrameGroups(frame, definition, params);
    default:
      throw new AnalysisUnsupportedError(
        definition.id,
        `input kind ${definition.inputKind} is not a per-frame shape`,
      );
  }
}

/**
 * The input kinds {@link runSingleFrame} implements, i.e. the analyses that
 * produce one payload per visited frame.
 *
 * The set, not a list of `if`s, so a caller can ask before it walks a range —
 * `./dispatch` and `./job_runner` both do.
 */
export const PER_FRAME_KINDS = new Set([
  "frame",
  "frameNeighbors",
  "frameClusters",
  "frameGroups",
  "frameRadii",
]);

// ---------------------------------------------------------------------------
// The accumulating shape
// ---------------------------------------------------------------------------

/**
 * A catalog binding driven as an accumulator: built once, fed every visited
 * frame, read out once.
 *
 * **Its home is this module, beside {@link runSingleFrame}.** `accumulate` is
 * one of the catalog's `inputKind`s like any other, so its driver belongs with
 * the per-frame shapes rather than with either thread's orchestration — and both
 * threads need it. Declaring it in `./dispatch` instead would force the worker
 * to import a main-thread module to get an accumulator, the one import direction
 * the layer table in `./index.ts` forbids.
 *
 * Owned by whoever constructs it — `./dispatch`'s `runAccumulate` on the main
 * thread, the shape dispatch in `./job_runner` on the worker — which is also
 * what calls {@link CatalogAccumulator.dispose}. The frame runner only feeds and
 * reads: releasing a holder of WASM (WebAssembly) handles that it did not build
 * would free memory out from under its owner.
 *
 * Two rules keep that memory from escaping this class. A subset feed builds a
 * sub-frame and frees it in the same call that built it — the rule
 * `MsdAnalyzer.feed` (`./msd`) already follows. And the binding's answer leaves
 * through `marshalAnalysisResult` (`./result_marshal`), which copies an owned
 * result handle's columns out and frees the handle, so what reaches the caller
 * owns no WASM memory at all.
 */
export class CatalogAccumulator implements TrajectoryAccumulateSink<unknown> {
  private readonly instance: WasmAnalysis;

  constructor(
    private readonly definition: AnalysisDefinition,
    params: AnalysisParamValues,
  ) {
    this.instance = instantiate(definition, params);
  }

  /**
   * Feed one frame, or just the selected atoms of it — the sub-frame is built
   * and freed here, in this call.
   *
   * @throws AnalysisUnsupportedError when a subset was asked for but the frame
   *   carries no atom coordinates to cut it from
   */
  feed(frame: Frame, atomIndices?: readonly number[]): void {
    if (!atomIndices) {
      this.instance.feed?.(frame);
      return;
    }
    const subFrame = buildAtomSubFrame(frame, atomIndices);
    if (!subFrame) {
      throw new AnalysisUnsupportedError(
        this.definition.id,
        "the frame has no atom coordinates to select from",
      );
    }
    try {
      this.instance.feed?.(subFrame);
    } finally {
      subFrame.free();
    }
  }

  /** What the fed frames add up to, as data that owns no WASM memory. */
  result(): unknown {
    return marshalAnalysisResult(this.definition.id, this.instance.compute?.());
  }

  /** Release the binding. */
  dispose(): void {
    this.instance.free?.();
  }
}
