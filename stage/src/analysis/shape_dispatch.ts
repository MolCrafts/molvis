/**
 * Run one catalog analysis: build its molrs compute from the parameters, read
 * its data off frames, call `compute` once, copy the result out.
 *
 * molrs is the Rust/WebAssembly (WASM) molecular core this package computes
 * with. Every compute follows one contract (`ComputeSpec`, joined with
 * molvis's rows in `./registry`): the constructor takes configuration only, in
 * spec order, and `compute(data)` takes one object of named data fields — or,
 * for the `Frames` form, an array of them. So there is no per-analysis code
 * here: {@link instantiate} builds any compute from its spec parameters,
 * `./compute_inputs` fills any data field from its source, and
 * `marshalAnalysisResult` (`./result_marshal`) copies any result out.
 *
 * Two drivers, by {@link AnalysisDefinition.inputKind}:
 * - {@link runSingleFrame} — every input is read off one frame;
 * - {@link CatalogAccumulator} — a time series is stacked across the fed
 *   frames and computed once.
 *
 * **Kernel-safe, and that is the reason it is its own module.** Nothing here
 * reaches Babylon, the DOM, a pipeline modifier or the stage `System`: the same
 * computation runs on the browser main thread (`./dispatch`) and inside the
 * analysis Web Worker (`./job_runner`). Main → Kernel is the only direction
 * allowed. Off every barrel on purpose — see the layer table in `./index.ts`.
 */

import type { Frame } from "@molcrafts/molvis-core/molrs";
import * as molrs from "@molcrafts/molvis-core/molrs";
import {
  FrameInputs,
  type ResolvedParams,
  TrajectoryInputs,
} from "./compute_inputs";
import type { AnalysisDefinition, AnalysisParamSpec } from "./registry";
import { marshalAnalysisResult } from "./result_marshal";
import {
  AnalysisUnsupportedError,
  type TrajectoryAccumulateSink,
} from "./trajectory_runner";

/**
 * Caller-supplied parameter values for one run, keyed by
 * {@link AnalysisParamSpec.key}. Coerced to the spec's declared kind before it
 * reaches a compute.
 *
 * The declaration lives here, beside {@link coerce}, because both the
 * main-thread panels and the worker's wire reader produce this shape;
 * `./dispatch` re-exports it under its original name.
 */
export type AnalysisParamValues = Record<string, number | boolean | string>;

// ---------------------------------------------------------------------------
// Parameter coercion
// ---------------------------------------------------------------------------

/** The molrs compute surface: configured, fed one data value, freed. */
interface WasmCompute {
  compute(data: unknown): unknown;
  free(): void;
}

type WasmClass = (new (
  ...args: unknown[]
) => WasmCompute) &
  Record<string, unknown>;

function wasmClass(name: string): WasmClass {
  const ctor = (molrs as unknown as Record<string, unknown>)[name];
  if (typeof ctor !== "function") {
    throw new Error(`@molcrafts/molvis-core/molrs does not export ${name}`);
  }
  return ctor as WasmClass;
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
    case "axis": {
      const parts = numbers(value);
      if (parts.length !== 3) {
        throw new Error(
          `${spec.key}: "${String(value)}" is not "min, max, bins"`,
        );
      }
      // The constructor that takes it consumes the handle.
      return new molrs.Axis(parts[0], parts[1], Math.trunc(parts[2]));
    }
  }
}

/** Every presented parameter of `definition`, coerced, by key. */
export function resolveParams(
  definition: AnalysisDefinition,
  params: AnalysisParamValues,
): ResolvedParams {
  return Object.fromEntries(
    definition.params.map((spec) => [spec.key, coerce(spec, params[spec.key])]),
  );
}

/** `over_natural_range` → `overNaturalRange`, the binding's static name. */
function camel(name: string): string {
  return name.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

/**
 * Build the compute of `definition` from its constructor parameters.
 *
 * Arguments go in spec order ({@link AnalysisDefinition.ctorArgs}); one with
 * no presented or supplied value is passed `undefined`, which molrs reads as
 * "keep the core default". A non-`new` form calls the static factory.
 *
 * The compute is the caller's: it holds WASM memory until `free`.
 *
 * @param supplied values molvis fills at run time (`max_lag`), by spec name
 */
export function instantiate(
  definition: AnalysisDefinition,
  params: ResolvedParams,
  supplied: Readonly<Record<string, unknown>> = {},
): WasmCompute {
  const Class = wasmClass(definition.specName);
  const args = definition.ctorArgs.map((name) =>
    name in supplied ? supplied[name] : params[name],
  );
  if (definition.ctor === "new") return new Class(...args);
  const factory = Class[camel(definition.ctor)];
  if (typeof factory !== "function") {
    throw new Error(
      `${definition.specName} has no constructor form ${definition.ctor}`,
    );
  }
  return factory.apply(Class, args) as WasmCompute;
}

// ---------------------------------------------------------------------------
// Per-frame driver
// ---------------------------------------------------------------------------

/**
 * Run one frame through a `frame`-kind analysis.
 *
 * @param frame the frame to analyse — read, never freed; it stays its
 *   trajectory's
 * @param definition the catalog entry
 * @param params values for the definition's parameters; an omitted key falls
 *   back to {@link AnalysisParamSpec.default}
 * @param selected rows of the atoms the caller picked, read by the
 *   `voidMask` source alone; pass an empty array for "no subset"
 * @returns plain data that owns no WASM memory
 * @throws AnalysisUnsupportedError when `inputKind` is not `frame`, or when
 *   the frame cannot supply an input
 */
export function runSingleFrame(
  frame: Frame,
  definition: AnalysisDefinition,
  params: AnalysisParamValues,
  selected: readonly number[],
): unknown {
  if (definition.inputKind !== "frame") {
    throw new AnalysisUnsupportedError(
      definition.id,
      `input kind ${definition.inputKind} is not a per-frame shape`,
    );
  }
  const resolved = resolveParams(definition, params);
  const inputs = new FrameInputs(frame, definition, resolved, selected);
  try {
    const data = inputs.data();
    const instance = instantiate(definition, resolved);
    try {
      return marshalAnalysisResult(
        definition.id,
        instance.compute(definition.form === "Frames" ? [data] : data),
      );
    } finally {
      instance.free();
    }
  } finally {
    inputs.dispose();
  }
}

/**
 * The input kinds {@link runSingleFrame} implements, i.e. the analyses that
 * produce one payload per visited frame.
 */
export const PER_FRAME_KINDS: ReadonlySet<string> = new Set(["frame"]);

// ---------------------------------------------------------------------------
// The accumulating driver
// ---------------------------------------------------------------------------

/**
 * A `trajectory`-kind analysis: fed every visited frame, computed once.
 *
 * Owned by whoever constructs it — `./dispatch` on the main thread,
 * `./job_runner` on the worker — which also calls
 * {@link CatalogAccumulator.dispose}. It holds no WASM memory between calls:
 * frames are copied into plain rows as they are fed, and the compute is built,
 * called and freed inside {@link CatalogAccumulator.result}.
 */
export class CatalogAccumulator implements TrajectoryAccumulateSink<unknown> {
  private readonly params: ResolvedParams;
  private readonly inputs: TrajectoryInputs;

  constructor(
    private readonly definition: AnalysisDefinition,
    params: AnalysisParamValues,
  ) {
    if (definition.inputKind !== "trajectory") {
      throw new AnalysisUnsupportedError(
        definition.id,
        `input kind ${definition.inputKind} does not accumulate`,
      );
    }
    this.params = resolveParams(definition, params);
    this.inputs = new TrajectoryInputs(definition);
  }

  /** Feed one frame, or just the selected atoms of it. */
  feed(frame: Frame, atomIndices?: readonly number[]): void {
    this.inputs.feed(frame, atomIndices);
  }

  /** What the fed frames add up to, as data that owns no WASM memory. */
  result(): unknown {
    const frames = this.inputs.count;
    const supplied: Record<string, unknown> = {};
    if (this.definition.supplied.includes("max_lag")) {
      supplied.max_lag = Math.max(frames - 1, 0);
    }
    const instance = instantiate(this.definition, this.params, supplied);
    try {
      return marshalAnalysisResult(
        this.definition.id,
        instance.compute(this.inputs.data(this.params)),
      );
    } finally {
      instance.free();
    }
  }

  /** Nothing to release: no WASM memory outlives a call. */
  dispose(): void {}
}
