import { molrsComputeCatalog } from "@molcrafts/molrs";

/**
 * The analysis registry is **derived from molrs**, not maintained here.
 *
 * `molrsComputeCatalog()` is the single source of truth: it names only
 * bindings that molrs-wasm actually exports, so an entry can never advertise
 * an analysis the WASM module cannot run. This module validates that payload
 * at the WASM boundary and re-shapes it for TypeScript consumers.
 */

/** How a caller drives the binding. Mirrors `input_kind` in the Rust catalog. */
export type AnalysisInputKind =
  | "frame"
  | "frameNeighbors"
  | "frameClusters"
  | "frameGroups"
  | "frameGroupSets"
  | "frameRadii"
  | "accumulate"
  | "series";

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
  | "textList";

/**
 * An input an analysis needs beyond atom positions.
 *
 * Split into two families by {@link isFrameColumnRequirement}: those a frame
 * either carries or does not (`velocity`, `dipole`, …), and those a panel
 * supplies from UI state (`atomPairs`, `descriptorMatrix`, …).
 */
export type AnalysisRequirement =
  | "velocity"
  | "charge"
  | "dipole"
  | "magneticDipole"
  | "polarizability"
  | "gTensor"
  | "orientation"
  | "atomPairs"
  | "atomTriples"
  | "atomQuads"
  | "atomGroups"
  | "scalarField"
  | "series"
  | "xySeries"
  | "descriptorMatrix"
  | "donors"
  | "acceptors"
  | "hbondPresence"
  | "hbondEdges"
  | "labels"
  | "voidMask"
  | "referenceAtoms"
  | "targetAtoms"
  | "template";

/**
 * Where a parameter is consumed.
 *
 * Every molrs binding is constructor-configured: `compute` and `fit` take only
 * data. So a parameter is either configuration for *this* analysis (`ctor`) or
 * configuration for a *different* object the caller builds first (`call`) —
 * `LinkedCell`'s cutoff, `Cluster`'s minimum size, an upstream flux stage's
 * resolution, or the column `labelBy` turns into a `labels` data argument.
 *
 * - `ctor` — a positional constructor argument, in declaration order, after
 *   any leading arguments the dispatch shape supplies itself. Trailing optional
 *   arguments may be omitted.
 * - `call` — never reaches this analysis's constructor.
 */
export type AnalysisParamSlot = "ctor" | "call";

export interface AnalysisParamSpec {
  key: string;
  label: string;
  kind: AnalysisParamKind;
  default: number | boolean | string;
  optional: boolean;
  slot: AnalysisParamSlot;
  min?: number;
  max?: number;
  unit?: string;
  options?: string[];
}

export interface AnalysisDefinition {
  id: string;
  category: string;
  label: string;
  /** Class exported by `@molcrafts/molrs`. Guaranteed to exist. */
  wasmExport: string;
  inputKind: AnalysisInputKind;
  resultKind: AnalysisResultKind;
  requires: AnalysisRequirement[];
  params: AnalysisParamSpec[];
}

export interface AnalysisCategory {
  id: string;
  label: string;
}

export interface AnalysisCatalog {
  version: number;
  categories: AnalysisCategory[];
  analyses: AnalysisDefinition[];
}

const INPUT_KINDS: ReadonlySet<string> = new Set<AnalysisInputKind>([
  "frame",
  "frameNeighbors",
  "frameClusters",
  "frameGroups",
  "frameGroupSets",
  "frameRadii",
  "accumulate",
  "series",
]);

const RESULT_KINDS: ReadonlySet<string> = new Set<AnalysisResultKind>([
  "lineSeries",
  "barSeries",
  "trajectorySeries",
  "table",
  "matrix",
  "grid3",
  "scalar",
  "custom",
]);

const PARAM_KINDS: ReadonlySet<string> = new Set<AnalysisParamKind>([
  "int",
  "float",
  "bool",
  "select",
  "intList",
  "floatList",
  "textList",
]);

/**
 * Requirements a frame either satisfies or does not, keyed to the atom columns
 * that satisfy them.
 *
 * Exactly **one** column set per requirement. Canonical field names are defined
 * once, in molrs `store::keys`; format-native spellings (LAMMPS `q`, `mol`) are
 * renamed to them at the reader boundary and never reach a frame. Accepting an
 * alias here would reintroduce the second source of truth that convention
 * exists to prevent.
 *
 * `magneticDipole`, `polarizability` and `gTensor` are deliberately absent:
 * molrs defines no canonical atom column for them, and for the spectroscopy
 * analyses that want them they are per-frame system quantities rather than
 * per-atom columns. They resolve to `upstreamResult` instead.
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
  return requirement in FRAME_COLUMN_REQUIREMENTS;
}

/** The canonical column set for a frame-column requirement. */
export function requirementColumns(
  requirement: AnalysisRequirement,
): readonly string[] {
  return FRAME_COLUMN_REQUIREMENTS[requirement] ?? [];
}

function fail(message: string): never {
  throw new Error(`molrsComputeCatalog: ${message}`);
}

function validateParam(raw: unknown, analysisId: string): AnalysisParamSpec {
  if (typeof raw !== "object" || raw === null) {
    fail(`${analysisId}: param entry is not an object`);
  }
  const p = raw as Record<string, unknown>;
  if (typeof p.key !== "string" || typeof p.label !== "string") {
    fail(`${analysisId}: param is missing key or label`);
  }
  if (typeof p.kind !== "string" || !PARAM_KINDS.has(p.kind)) {
    fail(`${analysisId}.${p.key}: unknown param kind ${String(p.kind)}`);
  }
  const value = p.default;
  if (
    typeof value !== "number" &&
    typeof value !== "boolean" &&
    typeof value !== "string"
  ) {
    fail(`${analysisId}.${p.key}: default must be number, boolean or string`);
  }
  if (p.slot !== "ctor" && p.slot !== "call") {
    fail(`${analysisId}.${p.key}: unknown param slot ${String(p.slot)}`);
  }
  return {
    key: p.key,
    label: p.label,
    kind: p.kind as AnalysisParamKind,
    default: value,
    optional: p.optional === true,
    slot: p.slot,
    min: typeof p.min === "number" ? p.min : undefined,
    max: typeof p.max === "number" ? p.max : undefined,
    unit: typeof p.unit === "string" ? p.unit : undefined,
    options: Array.isArray(p.options) ? (p.options as string[]) : undefined,
  };
}

function validateAnalysis(raw: unknown): AnalysisDefinition {
  if (typeof raw !== "object" || raw === null) {
    fail("analysis entry is not an object");
  }
  const a = raw as Record<string, unknown>;
  const id = a.id;
  if (typeof id !== "string") fail("analysis entry is missing an id");
  if (typeof a.category !== "string" || typeof a.label !== "string") {
    fail(`${id}: missing category or label`);
  }
  if (typeof a.wasmExport !== "string") fail(`${id}: missing wasmExport`);
  if (typeof a.inputKind !== "string" || !INPUT_KINDS.has(a.inputKind)) {
    fail(`${id}: unknown inputKind ${String(a.inputKind)}`);
  }
  if (typeof a.resultKind !== "string" || !RESULT_KINDS.has(a.resultKind)) {
    fail(`${id}: unknown resultKind ${String(a.resultKind)}`);
  }
  const requires = Array.isArray(a.requires) ? a.requires : [];
  const params = Array.isArray(a.params) ? a.params : [];
  return {
    id,
    category: a.category,
    label: a.label,
    wasmExport: a.wasmExport,
    inputKind: a.inputKind as AnalysisInputKind,
    resultKind: a.resultKind as AnalysisResultKind,
    requires: requires as AnalysisRequirement[],
    params: params.map((param) => validateParam(param, id)),
  };
}

function validateCatalog(raw: unknown): AnalysisCatalog {
  if (typeof raw !== "object" || raw === null) fail("payload is not an object");
  const c = raw as Record<string, unknown>;
  if (typeof c.version !== "number") fail("missing version");
  if (!Array.isArray(c.categories)) fail("missing categories");
  if (!Array.isArray(c.analyses)) fail("missing analyses");

  const categories = c.categories.map((entry): AnalysisCategory => {
    const e = entry as Record<string, unknown>;
    if (typeof e.id !== "string" || typeof e.label !== "string") {
      fail("category is missing id or label");
    }
    return { id: e.id, label: e.label };
  });

  const declared = new Set(categories.map((entry) => entry.id));
  const analyses = c.analyses.map(validateAnalysis);
  for (const analysis of analyses) {
    if (!declared.has(analysis.category)) {
      fail(`${analysis.id}: category ${analysis.category} is not declared`);
    }
  }
  return { version: c.version, categories, analyses };
}

let cached: AnalysisCatalog | undefined;

/**
 * The molrs compute catalog, validated and memoized.
 *
 * Safe to call during render: `@molcrafts/molrs` is a `--target bundler`
 * package whose WASM instance is initialized during module evaluation, so the
 * export is live by the time any molvis module body runs.
 */
export function getAnalysisCatalog(): AnalysisCatalog {
  if (!cached) cached = validateCatalog(molrsComputeCatalog());
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
