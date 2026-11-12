import { ComputeSpec } from "@molcrafts/molvis-core/molrs";
import { ANALYSIS_ROWS, type AnalysisRow, type InputSource } from "./ui_rows";

/**
 * The analysis registry: molrs's compute descriptors joined with molvis's
 * presentation rows.
 *
 * `ComputeSpec.all()` (molrs) is the truth about every compute: its class name,
 * its constructor parameters (kind, default, required or not), the data fields
 * its `compute` takes and whether it takes one object or an array of per-frame
 * objects. It says nothing about presentation. Labels, categories, units,
 * slider ranges, the result renderer and the knobs that configure *other*
 * objects (a neighbor cutoff, a cluster size) are molvis's, in
 * `./ui_rows`, keyed on `(spec.name, param.name)`.
 *
 * {@link getAnalysisCatalog} validates the join once, at first use:
 * - a row naming a spec molrs does not have is an error;
 * - a row naming a parameter its spec does not have is an error;
 * - a required spec parameter no row value or molvis supplies is an error;
 * - a spec with no row is not an error — it is listed in
 *   {@link AnalysisCatalog.unpresented}, so the gap is visible.
 */

/**
 * How molvis drives an analysis, derived from where its inputs come from.
 *
 * - `frame` — every input is read off one frame: one payload per frame.
 * - `trajectory` — an input is a time series stacked across the visited
 *   frames: one payload for the whole range.
 */
export type AnalysisInputKind = "frame" | "trajectory";

/** Shape of an analysis payload, for picking a renderer. */
export type AnalysisResultKind =
  | "lineSeries"
  | "barSeries"
  | "trajectorySeries"
  | "table"
  | "matrix"
  | "grid3"
  | "scalar"
  | "custom";

/** How to render and coerce a parameter. */
export type AnalysisParamKind =
  | "int"
  | "float"
  | "bool"
  | "select"
  | "intList"
  | "floatList"
  | "textList"
  | "axis";

/**
 * An input an analysis needs beyond atom positions.
 *
 * Split into two families by {@link isFrameColumnRequirement}: those a frame
 * either carries or does not (`velocity`, `box`, …), and those a panel
 * supplies from UI state (`atomPairs`, `voidMask`, …).
 */
export type AnalysisRequirement =
  | "velocity"
  | "charge"
  | "dipole"
  | "orientation"
  | "box"
  | "atomPairs"
  | "labels"
  | "voidMask"
  | "descriptorMatrix";

/**
 * Where a parameter is consumed.
 *
 * - `ctor` — a constructor argument of the analysis itself (a spec parameter).
 * - `call` — configuration of something molvis builds to feed it: the
 *   neighbor table's cutoff, the clustering behind a partition, the timestep.
 */
export type AnalysisParamSlot = "ctor" | "call";

export interface AnalysisParamSpec {
  /** The spec parameter name (snake_case) for `ctor`, a molvis key for `call`. */
  key: string;
  label: string;
  kind: AnalysisParamKind;
  default: number | boolean | string;
  /** True when the core has a default, so leaving the value off is valid. */
  optional: boolean;
  slot: AnalysisParamSlot;
  min?: number;
  max?: number;
  unit?: string;
  options?: string[];
}

/** One `compute` data field of the spec, and where molvis reads it from. */
export interface AnalysisInputSpec {
  /** The `compute` field name (snake_case), as the spec lists it. */
  name: string;
  /** The spec's input kind name (`Positions`, `Neighbors`, …). */
  kind: string;
  optional: boolean;
  /** Where molvis reads the data; absent for an optional input it leaves off. */
  source?: InputSource;
}

export interface AnalysisDefinition {
  id: string;
  category: string;
  label: string;
  /** molrs class (`ComputeSpec` name); empty for an entry molrs does not run. */
  specName: string;
  /** Constructor form: `new` or a static factory named by the spec. */
  ctor: string;
  /**
   * The constructor's positional arguments, by spec parameter name, in order.
   * One left without a value is passed `undefined`, which molrs reads as "keep
   * the core default".
   */
  ctorArgs: string[];
  /** The parameter key whose value is the neighbor-table cutoff. */
  neighborCutoff: string;
  /** `Single` takes one data object, `Frames` an array of per-frame ones. */
  form: "Single" | "Frames";
  inputs: AnalysisInputSpec[];
  inputKind: AnalysisInputKind;
  resultKind: AnalysisResultKind;
  requires: AnalysisRequirement[];
  /** Presented parameters: the spec's `ctor` ones, then molvis's `call` ones. */
  params: AnalysisParamSpec[];
  /**
   * Spec parameters molvis fills at run time instead of asking (`max_lag`
   * from the number of frames fed).
   */
  supplied: string[];
}

export interface AnalysisCategory {
  id: string;
  label: string;
}

export interface AnalysisCatalog {
  categories: AnalysisCategory[];
  analyses: AnalysisDefinition[];
  /** `ComputeSpec` names molvis has no row for — reported, not presented. */
  unpresented: string[];
}

/** Menu categories, in picker order. */
const CATEGORIES: readonly AnalysisCategory[] = [
  { id: "density", label: "Density" },
  { id: "locality", label: "Locality" },
  { id: "msd", label: "Msd" },
  { id: "cluster", label: "Cluster" },
  { id: "order", label: "Order" },
  { id: "environment", label: "Environment" },
  { id: "diffraction", label: "Diffraction" },
  { id: "pmft", label: "PMFT" },
  { id: "transport", label: "Transport" },
  { id: "spectroscopy", label: "Spectroscopy" },
  { id: "distribution", label: "Distribution" },
  { id: "shape", label: "Shape" },
  { id: "ml", label: "ML" },
];

/**
 * Requirements a frame either satisfies or does not, keyed to the atom columns
 * that satisfy them.
 *
 * Exactly **one** column set per requirement. Canonical field names are defined
 * once, in molrs `store::keys`; format-native spellings (LAMMPS `q`, `mol`) are
 * renamed to them at the reader boundary and never reach a frame. Accepting an
 * alias here would reintroduce the second source of truth that convention
 * exists to prevent. `box` is the frame's cell, not a column — its probe is
 * `./requirements`'s.
 */
const FRAME_COLUMN_REQUIREMENTS: Readonly<
  Partial<Record<AnalysisRequirement, readonly string[]>>
> = {
  velocity: ["vx", "vy", "vz"],
  charge: ["charge"],
  dipole: ["mux", "muy", "muz"],
  orientation: ["quatw", "quati", "quatj", "quatk"],
};

export function isFrameColumnRequirement(
  requirement: AnalysisRequirement,
): boolean {
  return requirement in FRAME_COLUMN_REQUIREMENTS || requirement === "box";
}

/** The canonical column set for a frame-column requirement. */
export function requirementColumns(
  requirement: AnalysisRequirement,
): readonly string[] {
  return FRAME_COLUMN_REQUIREMENTS[requirement] ?? [];
}

// ---------------------------------------------------------------------------
// The molrs descriptor, as `ComputeSpec.all()` serialises it
// ---------------------------------------------------------------------------

/** `ParamKind`: a bare name, or `{ Choice: names }` / `{ ChoiceList: names }`. */
type RawParamKind = string | { Choice: string[] } | { ChoiceList: string[] };

/** `ParamValue` as serde writes it. */
type RawParamValue =
  | "Unset"
  | { Int: number }
  | { Float: number }
  | { Bool: boolean }
  | { Name: string }
  | { FloatList: number[] }
  | { IntList: number[] }
  | { Range: [number, number] };

/** `ParamDefault` as serde writes it. */
type RawParamDefault =
  | "Required"
  | { RequiredIn: string }
  | { Value: RawParamValue }
  | { SameAs: string }
  | { Scaled: { of: string; factor: number } };

interface RawParam {
  name: string;
  kind: RawParamKind;
  default: RawParamDefault;
}

interface RawInput {
  name: string;
  kind: string | Record<string, unknown>;
  optional: boolean;
}

/** One `ComputeSpec.all()` entry, as serde writes it. */
export interface RawSpec {
  name: string;
  params: RawParam[];
  inputs: RawInput[];
  form: "Single" | "Frames";
}

function fail(message: string): never {
  throw new Error(`analysis catalog: ${message}`);
}

/** The required form of a parameter: `true` always, a ctor name, or `false`. */
function requiredIn(param: RawParam): boolean | string {
  if (param.default === "Required") return true;
  if (typeof param.default === "object" && "RequiredIn" in param.default) {
    return param.default.RequiredIn;
  }
  return false;
}

function isRequiredFor(param: RawParam, ctor: string): boolean {
  const required = requiredIn(param);
  return required === true || required === ctor;
}

/** The default a spec carries as a plain value, if it carries one. */
function specValue(param: RawParam): number | boolean | string | undefined {
  const d = param.default;
  if (typeof d !== "object" || !("Value" in d)) return undefined;
  const value = d.Value;
  if (value === "Unset") return undefined;
  if ("Int" in value) return value.Int;
  if ("Float" in value) return value.Float;
  if ("Bool" in value) return value.Bool;
  if ("Name" in value) return value.Name;
  if ("IntList" in value) return value.IntList.join(",");
  if ("FloatList" in value) return value.FloatList.join(",");
  return undefined;
}

/** A `ParamKind` molvis can present, or `undefined` when it cannot. */
function presentableKind(
  kind: RawParamKind,
): { kind: AnalysisParamKind; options?: string[] } | undefined {
  if (typeof kind === "object") {
    if ("Choice" in kind) return { kind: "select", options: [...kind.Choice] };
    if ("ChoiceList" in kind) return { kind: "textList" };
    return undefined;
  }
  switch (kind) {
    case "Float":
      return { kind: "float" };
    case "Int":
      return { kind: "int" };
    case "Bool":
      return { kind: "bool" };
    case "IntList":
      return { kind: "intList" };
    case "FloatList":
      return { kind: "floatList" };
    case "Axis":
      return { kind: "axis" };
    default:
      return undefined;
  }
}

function inputKindName(kind: RawInput["kind"]): string {
  return typeof kind === "string" ? kind : Object.keys(kind)[0];
}

/**
 * Where molvis reads an input when its row says nothing: one entry per
 * `(kind, name)` molvis knows how to fill from a frame.
 */
function defaultSource(input: RawInput): InputSource | undefined {
  const kind = inputKindName(input.kind);
  switch (kind) {
    case "Positions":
      return input.name === "positions" ? "positions" : undefined;
    case "SimBox":
      return "box";
    case "Neighbors":
    case "PairSource":
      return "neighbors";
    case "Partition":
      return "clusters";
    case "Scalars":
      if (input.name === "masses" || input.name === "weights") return "masses";
      if (input.name === "radii") return "radii";
      return undefined;
    case "Tuples":
      return "bondTuples";
    case "Mask":
      return input.name === "is_void" ? "voidMask" : undefined;
    case "Scalar":
      if (input.name === "dt") return "timestep";
      if (input.name === "box_volume") return "boxVolume";
      return undefined;
    case "Trajectory":
      return input.name === "positions" ? "positionTrajectory" : undefined;
    case "Series":
      return input.name === "velocities" ? "velocitySeries" : undefined;
    case "FeatureMatrix":
      return "descriptors";
    case "Upstream": {
      const upstream = (input.kind as Record<string, unknown>).Upstream;
      if (upstream === "VoronoiCells") return "voronoiCells";
      if (upstream === "QlmTable") return "qlm";
      return undefined;
    }
    default:
      return undefined;
  }
}

/** The requirement a source puts on the frame, if any. */
function sourceRequirement(
  source: InputSource,
  optional: boolean,
): AnalysisRequirement | undefined {
  switch (source) {
    case "box":
    case "boxVolume":
      return optional ? undefined : "box";
    case "bondTuples":
      return "atomPairs";
    case "labels":
      return "labels";
    case "voidMask":
      return "voidMask";
    case "velocitySeries":
    case "velocityAcf":
      return "velocity";
    case "descriptors":
      return "descriptorMatrix";
    default:
      return undefined;
  }
}

const TRAJECTORY_SOURCES: ReadonlySet<InputSource> = new Set<InputSource>([
  "positionTrajectory",
  "velocitySeries",
  "velocityAcf",
]);

/** The `call` keys each source reads; a row using the source must declare them. */
const SOURCE_CALL_KEYS: Readonly<Partial<Record<InputSource, string[]>>> = {
  clusters: ["cutoff", "min_cluster_size"],
  labels: ["label_by"],
  radii: ["use_atom_radii"],
  voronoiCells: ["use_atom_radii"],
  qlm: ["l"],
  timestep: ["dt"],
  velocityAcf: ["max_lag"],
};

function buildDefinition(spec: RawSpec, row: AnalysisRow): AnalysisDefinition {
  const where = `${row.id} (${spec.name})`;
  const ctor = row.ctor ?? "new";
  const supplied = row.supplied ?? [];
  const rowParams = row.params ?? {};
  const specParams = new Map(spec.params.map((param) => [param.name, param]));

  for (const name of [...Object.keys(rowParams), ...supplied]) {
    if (!specParams.has(name)) fail(`${where}: no spec parameter ${name}`);
  }

  const ctorParams: AnalysisParamSpec[] = [];
  for (const param of spec.params) {
    const ui = rowParams[param.name];
    if (!ui) {
      if (isRequiredFor(param, ctor) && !supplied.includes(param.name)) {
        fail(`${where}: required parameter ${param.name} has no row`);
      }
      continue;
    }
    const kind = presentableKind(param.kind);
    if (!kind) {
      fail(
        `${where}.${param.name}: kind ${JSON.stringify(param.kind)} cannot be presented`,
      );
    }
    const value = ui.default ?? specValue(param);
    if (value === undefined) fail(`${where}.${param.name}: no default value`);
    ctorParams.push({
      key: param.name,
      label: ui.label,
      kind: kind.kind,
      default: value,
      optional: requiredIn(param) === false,
      slot: "ctor",
      min: ui.min,
      max: ui.max,
      unit: ui.unit,
      options: kind.options,
    });
  }

  const callParams: AnalysisParamSpec[] = (row.call ?? []).map((param) => ({
    ...param,
    optional: false,
    slot: "call",
  }));
  const declared = new Set([
    ...callParams.map((param) => param.key),
    ...ctorParams.map((param) => param.key),
  ]);
  if (row.neighborCutoff && !declared.has(row.neighborCutoff)) {
    fail(`${where}: neighbor cutoff ${row.neighborCutoff} is not a parameter`);
  }

  const rowSources = row.sources ?? {};
  for (const name of Object.keys(rowSources)) {
    if (!spec.inputs.some((input) => input.name === name)) {
      fail(`${where}: no spec input ${name}`);
    }
  }
  const inputs: AnalysisInputSpec[] = spec.inputs.map((input) => {
    // An optional input is fed only when the row asks for it — except the
    // cell, which molvis passes whenever the frame has one.
    const fallback =
      input.optional && inputKindName(input.kind) !== "SimBox"
        ? undefined
        : defaultSource(input);
    const source = rowSources[input.name] ?? fallback;
    if (!source && !input.optional) {
      fail(`${where}: molvis has no source for input ${input.name}`);
    }
    return {
      name: input.name,
      kind: inputKindName(input.kind),
      optional: input.optional,
      source,
    };
  });

  const requires = new Set<AnalysisRequirement>();
  for (const input of inputs) {
    if (!input.source) continue;
    const requirement = sourceRequirement(input.source, input.optional);
    if (requirement) requires.add(requirement);
    for (const key of SOURCE_CALL_KEYS[input.source] ?? []) {
      // Cluster's own minimum size is a spec parameter, not a call knob.
      if (!declared.has(key)) {
        fail(`${where}: input ${input.name} needs parameter ${key}`);
      }
    }
    if (
      input.source === "neighbors" &&
      !row.neighborCutoff &&
      !declared.has("cutoff")
    ) {
      fail(`${where}: input ${input.name} needs a neighbor cutoff`);
    }
  }

  const inputKind: AnalysisInputKind = inputs.some(
    (input) => input.source && TRAJECTORY_SOURCES.has(input.source),
  )
    ? "trajectory"
    : "frame";

  return {
    id: row.id,
    category: row.category,
    label: row.label,
    specName: spec.name,
    ctor,
    ctorArgs: spec.params
      .filter((param) =>
        ctor === "new"
          ? requiredIn(param) === true ||
            requiredIn(param) === false ||
            requiredIn(param) === "new"
          : isRequiredFor(param, ctor),
      )
      .map((param) => param.name),
    neighborCutoff: row.neighborCutoff ?? "cutoff",
    form: spec.form,
    inputs,
    inputKind,
    resultKind: row.resultKind,
    requires: [...requires],
    params: [...ctorParams, ...callParams],
    supplied,
  };
}

/**
 * Join `specs` (molrs's descriptors) with `rows` (molvis's presentation).
 *
 * Exported for the tests, which feed it hand-written specs to prove each
 * validation rule bites; production code calls {@link getAnalysisCatalog}.
 *
 * @throws Error naming the row and the field when the join is invalid
 */
export function buildAnalysisCatalog(
  specs: readonly RawSpec[],
  rows: readonly AnalysisRow[],
): AnalysisCatalog {
  const byName = new Map(specs.map((spec) => [spec.name, spec]));
  const ids = new Set<string>();
  const presented = new Set<string>();
  const declared = new Set(CATEGORIES.map((category) => category.id));
  const analyses = rows.map((row) => {
    const spec = byName.get(row.spec);
    if (!spec) fail(`${row.id}: molrs has no compute named ${row.spec}`);
    if (presented.has(row.spec)) fail(`${row.spec}: more than one row`);
    if (ids.has(row.id)) fail(`${row.id}: duplicate id`);
    if (!declared.has(row.category)) {
      fail(`${row.id}: category ${row.category} is not declared`);
    }
    presented.add(row.spec);
    ids.add(row.id);
    return buildDefinition(spec, row);
  });
  const unpresented = specs
    .map((spec) => spec.name)
    .filter((name) => !presented.has(name));
  return { categories: [...CATEGORIES], analyses, unpresented };
}

let cached: AnalysisCatalog | undefined;

/**
 * The analysis catalog, validated and memoized.
 *
 * Safe to call during render: `@molcrafts/molvis-core/molrs` is a `--target bundler`
 * package whose WASM instance is initialized during module evaluation, so the
 * export is live by the time any molvis module body runs.
 */
export function getAnalysisCatalog(): AnalysisCatalog {
  if (!cached) {
    cached = buildAnalysisCatalog(
      ComputeSpec.all() as RawSpec[],
      ANALYSIS_ROWS,
    );
  }
  return cached;
}

export function listAnalyses(category?: string): AnalysisDefinition[] {
  const { analyses } = getAnalysisCatalog();
  return category === undefined
    ? analyses
    : analyses.filter((analysis) => analysis.category === category);
}

export function getAnalysisDefinition(
  id: string,
): AnalysisDefinition | undefined {
  return getAnalysisCatalog().analyses.find((analysis) => analysis.id === id);
}

export function listAnalysisCategories(): AnalysisCategory[] {
  return getAnalysisCatalog().categories;
}

export function listAnalysisCategoriesWithEntries(): Array<{
  category: AnalysisCategory;
  analyses: AnalysisDefinition[];
}> {
  return getAnalysisCatalog()
    .categories.map((category) => ({
      category,
      analyses: listAnalyses(category.id),
    }))
    .filter((entry) => entry.analyses.length > 0);
}

/** Default parameter values of an analysis, keyed by param key. */
export function defaultAnalysisParams(
  definition: AnalysisDefinition,
): Record<string, number | boolean | string> {
  return Object.fromEntries(
    definition.params.map((param) => [param.key, param.default]),
  );
}

export type { InputSource } from "./ui_rows";
