/**
 * Energy models + optimizers for structure minimize.
 *
 * **Composable:** `potential` (UFF / MMFF / soft) × `optimizer` (lbfgs / damped).
 * - molrs force fields → {@link runLbfgsOptimize}
 * - soft springs → {@link runDampedOptimize}
 *
 * App orchestration: {@link ./structure}.
 */

import {
  type Frame,
  type LBFGS,
  MMFF94STypifier,
  MMFF94Typifier,
  type Potentials,
  UFFTypifier,
} from "@molcrafts/molvis-core/molrs";
import {
  forceFieldNonbondedCutoff,
  LbfgsNeighborStrategy,
} from "../algo/neighbor_list";
import { shouldDrawBox } from "../io/box_presence";
import { safeFree, yieldToUi as yieldUi } from "../utils/yield_ui";

/** Energy / force-field model. */
export type PotentialKind = "uff" | "mmff94" | "mmff94s" | "soft";

/** Geometry optimizer. Pair with {@link PotentialKind} via {@link resolveOptimizePair}. */
export type OptimizerKind = "lbfgs" | "damped";

export interface OptimizePair {
  potential: PotentialKind;
  optimizer: OptimizerKind;
}

/** Default optimizer for a potential. */
export function defaultOptimizer(potential: PotentialKind): OptimizerKind {
  return potential === "soft" ? "damped" : "lbfgs";
}

/**
 * Resolve a (potential, optimizer) pair. Throws on illegal combinations
 * (e.g. soft+lbfgs, uff+damped) until more pairings exist.
 */
export function resolveOptimizePair(
  potential: PotentialKind,
  optimizer?: OptimizerKind,
): OptimizePair {
  const opt = optimizer ?? defaultOptimizer(potential);
  if (potential === "soft" && opt !== "damped") {
    throw new Error(
      `potential 'soft' only supports optimizer 'damped', got '${opt}'`,
    );
  }
  if (potential !== "soft" && opt !== "lbfgs") {
    throw new Error(
      `potential '${potential}' only supports optimizer 'lbfgs', got '${opt}'`,
    );
  }
  return { potential, optimizer: opt };
}

/** No status beat for this long → page may prompt Continue / Cancel. */
export const OPTIMIZE_STALL_MS = 12_000;

/**
 * Interactive hard cap for WASM force-field L-BFGS (LinkedCell path).
 * BruteForce NeighborList is used below the speed crossover; LinkedCell above.
 */
export const LBFGS_MAX_ATOMS = 80_000;

/** Soft warn when multi-step minimize will stall the main thread for a while. */
const LBFGS_WARN_ATOMS = 15_000;

/**
 * Fraction of estimated device RAM reserved for one optimize job.
 * Leaves headroom for the scene, browser chrome, and OS.
 */
const BUDGET_DEVICE_FRACTION = 0.22;

/** Fraction of V8 heap size limit we may target when Chrome exposes it. */
const BUDGET_HEAP_FRACTION = 0.45;

/** Fallback budget when no memory APIs exist (≈ mid laptop, 4 GiB device). */
const BUDGET_DEFAULT_BYTES = 900 * 1024 * 1024;

/** Soft O(N²) pair budget baseline at 4 GiB, scaled with √(deviceGiB/4). */
const SOFT_PAIR_BUDGET_BASE = 4_000_000;

/** Soft: warn when estimated pairs per step exceed this fraction of budget. */
const SOFT_PAIR_WARN_FRACTION = 0.35;

/** Soft: hard-block when pairs per step exceed this fraction of budget. */
const SOFT_PAIR_BLOCK_FRACTION = 1.0;

/** Memory: warn when peak estimate exceeds this fraction of the job budget. */
const MEM_WARN_FRACTION = 0.4;

/** Memory: hard-block when peak estimate exceeds this fraction of the job budget. */
const MEM_BLOCK_FRACTION = 0.95;

export type OptimizePhase =
  | "snapshot"
  | "hydrogens"
  | "prepare"
  | "pipeline"
  | "minimize"
  | "finalize";

export interface OptimizeStatus {
  phase: OptimizePhase;
  /** Short status-bar line, e.g. `Minimizing… step 40/200`. */
  message: string;
  /** 0–100 when known. */
  progress?: number;
  step?: number;
  maxSteps?: number;
}

export type OptimizeStatusCallback = (status: OptimizeStatus) => void;

/** Yield so React/paint can run between heavy sync chunks. */
export function yieldToUi(): Promise<void> {
  return yieldUi();
}

/**
 * Optional runtime signals for memory budgeting. Pass bond counts for a
 * tighter estimate; omit memory fields to use {@link probeBrowserMemory}.
 */
export interface OptimizeResourceProbe {
  /** `navigator.deviceMemory` (GiB), when available. */
  deviceMemoryGiB?: number | null;
  /** Chrome `performance.memory.jsHeapSizeLimit`. */
  jsHeapSizeLimitBytes?: number | null;
  /** Bond count; defaults to ~N (molecular topology heuristic). */
  bondCount?: number;
}

export type OptimizeSizeRisk = "ok" | "warn" | "soft_block" | "hard_block";

export interface OptimizeSizeAssessment {
  level: OptimizeSizeRisk;
  message: string;
  /** Estimated peak working set for this run. */
  estimateBytes: number;
  /** Device-derived budget for the job. */
  budgetBytes: number;
  /** Soft path only: estimated unique pairs per force eval. */
  softPairs?: number;
  softPairBudget?: number;
}

/** Read coarse device / JS-heap signals (empty when APIs are absent). */
export function probeBrowserMemory(): OptimizeResourceProbe {
  const nav = (globalThis as { navigator?: { deviceMemory?: number } })
    .navigator;
  const deviceMemoryGiB =
    typeof nav?.deviceMemory === "number" && nav.deviceMemory > 0
      ? nav.deviceMemory
      : null;
  const limit = (
    globalThis as {
      performance?: { memory?: { jsHeapSizeLimit?: number } };
    }
  ).performance?.memory?.jsHeapSizeLimit;
  const jsHeapSizeLimitBytes =
    typeof limit === "number" && limit > 0 ? limit : null;
  return { deviceMemoryGiB, jsHeapSizeLimitBytes };
}

/**
 * Peak memory budget for one optimize job on this machine.
 * Prefer the tighter of device-RAM share and JS heap share.
 */
export function resolveOptimizeMemoryBudget(
  probe: OptimizeResourceProbe = {},
): {
  budgetBytes: number;
  deviceBytes: number | null;
  jsHeapLimitBytes: number | null;
  source: "deviceMemory" | "jsHeap" | "default" | "min(device,heap)";
} {
  const deviceGiB =
    typeof probe.deviceMemoryGiB === "number" && probe.deviceMemoryGiB > 0
      ? probe.deviceMemoryGiB
      : null;
  const heapLimit =
    typeof probe.jsHeapSizeLimitBytes === "number" &&
    probe.jsHeapSizeLimitBytes > 0
      ? probe.jsHeapSizeLimitBytes
      : null;

  const deviceBytes =
    deviceGiB !== null ? deviceGiB * 1024 * 1024 * 1024 : null;
  const fromDevice =
    deviceBytes !== null ? deviceBytes * BUDGET_DEVICE_FRACTION : null;
  const fromHeap = heapLimit !== null ? heapLimit * BUDGET_HEAP_FRACTION : null;

  if (fromDevice !== null && fromHeap !== null) {
    return {
      budgetBytes: Math.floor(Math.min(fromDevice, fromHeap)),
      deviceBytes,
      jsHeapLimitBytes: heapLimit,
      source: "min(device,heap)",
    };
  }
  if (fromDevice !== null) {
    return {
      budgetBytes: Math.floor(fromDevice),
      deviceBytes,
      jsHeapLimitBytes: heapLimit,
      source: "deviceMemory",
    };
  }
  if (fromHeap !== null) {
    return {
      budgetBytes: Math.floor(fromHeap),
      deviceBytes,
      jsHeapLimitBytes: heapLimit,
      source: "jsHeap",
    };
  }
  return {
    budgetBytes: BUDGET_DEFAULT_BYTES,
    deviceBytes: null,
    jsHeapLimitBytes: null,
    source: "default",
  };
}

/**
 * Conservative peak-byte model for a main-thread optimize run.
 *
 * Not a profiler — order-of-magnitude so we can refuse/warn before WASM
 * grows the heap into a tab kill. Includes:
 * - several coord buffers (working / typed / pack)
 * - bond topology + atom metadata
 * - L-BFGS history (m≈10) or soft force/vel arrays
 * - short-range pair / topology scratch
 * - WASM heap fragmentation overhead
 */
export function estimateOptimizePeakBytes(
  atomCount: number,
  potential: PotentialKind | string,
  bondCount?: number,
): number {
  const n = Math.max(0, Math.floor(atomCount));
  if (n === 0) return 0;
  const nb = Math.max(
    0,
    Math.floor(bondCount ?? Math.max(n, Math.floor(n * 1.2))),
  );
  const f64 = 8;
  const coords = n * 3 * f64;
  // Working frame + typed/copy + packed xyz + GPU-facing shadow.
  const frames = coords * 4 + n * 64 + nb * 32;

  if (potential === "soft") {
    // fx/fy/fz + vx/vy/vz + adjacency lists (avg degree ~4).
    const soft = n * 6 * f64 + n * 48;
    return Math.ceil((frames + soft) * 1.6);
  }

  // L-BFGS s/y history, m≈10.
  const lbfgs = 10 * 2 * coords;
  // Potentials params + typed atom types.
  const pots = nb * 80 + n * 160;
  // Topology / short-range pair scratch (~40 endpoints per atom).
  const pairs = n * 40 * 16;
  // WASM linear memory growth is coarse; inflate heavily.
  return Math.ceil((frames + lbfgs + pots + pairs) * 2.4);
}

/** Soft nonbonded unique pairs per force evaluation (i < j). */
export function estimateSoftPairs(atomCount: number): number {
  const n = Math.max(0, Math.floor(atomCount));
  return (n * Math.max(0, n - 1)) / 2;
}

/**
 * How many soft i–j pairs this device can afford per force step before
 * the main thread freezes for a long time. Scales with √deviceMemory.
 */
export function softPairBudget(
  deviceMemoryGiB: number | null | undefined,
): number {
  const g =
    typeof deviceMemoryGiB === "number" && deviceMemoryGiB > 0
      ? deviceMemoryGiB
      : 4;
  return Math.floor(SOFT_PAIR_BUDGET_BASE * Math.sqrt(g / 4));
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const mb = bytes / (1024 * 1024);
  if (mb < 1) return `${Math.round(bytes / 1024)} KB`;
  if (mb < 1024) return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
  const gb = mb / 1024;
  return `${gb < 10 ? gb.toFixed(1) : Math.round(gb)} GB`;
}

/**
 * Decide whether this optimize run is safe on the current machine.
 *
 * Uses **estimated peak memory vs device budget**, not fixed atom caps —
 * a 32 GiB workstation can take larger jobs than a 4 GiB laptop.
 * Soft still gets a pair-work gate (O(N²) CPU), scaled by device memory.
 */
export function assessOptimizeSize(
  atomCount: number,
  potential: PotentialKind | string,
  probe: OptimizeResourceProbe = {},
): OptimizeSizeAssessment {
  const n = Math.max(0, Math.floor(atomCount));
  const merged: OptimizeResourceProbe = {
    ...probeBrowserMemory(),
    ...probe,
  };
  const { budgetBytes, deviceBytes } = resolveOptimizeMemoryBudget(merged);
  const estimateBytes = estimateOptimizePeakBytes(
    n,
    potential,
    merged.bondCount,
  );
  const atoms = n.toLocaleString();
  const est = formatBytes(estimateBytes);
  const bud = formatBytes(budgetBytes);

  if (potential === "soft") {
    const pairs = estimateSoftPairs(n);
    const pairBudget = softPairBudget(merged.deviceMemoryGiB ?? null);
    if (pairs > pairBudget * SOFT_PAIR_BLOCK_FRACTION) {
      return {
        level: "soft_block",
        message: `Soft spring is O(N²): ~${formatPairCount(pairs)} pairs/step for ${atoms} atoms exceeds this device (~${formatPairCount(pairBudget)}). Switch to UFF / MMFF94.`,
        estimateBytes,
        budgetBytes,
        softPairs: pairs,
        softPairBudget: pairBudget,
      };
    }
    if (
      pairs > pairBudget * SOFT_PAIR_WARN_FRACTION ||
      estimateBytes > budgetBytes * MEM_WARN_FRACTION
    ) {
      return {
        level: "warn",
        message: `Soft spring on ${atoms} atoms (~${formatPairCount(pairs)} pairs/step, est. ${est} peak · budget ${bud}) may freeze the tab for a long time.`,
        estimateBytes,
        budgetBytes,
        softPairs: pairs,
        softPairBudget: pairBudget,
      };
    }
  }

  // Interactive main-thread cap (NL-backed L-BFGS). Not the O(N²) panic cliff.
  if (isMolrsPotential(potential) && n > LBFGS_MAX_ATOMS) {
    return {
      level: "hard_block",
      message:
        `${atoms} atoms exceeds the interactive browser force-field limit ` +
        `(${LBFGS_MAX_ATOMS.toLocaleString()}). Isolate a region, or run ` +
        `offline — multi-step UFF/MMFF on this size will freeze the tab.`,
      estimateBytes,
      budgetBytes,
    };
  }

  if (estimateBytes > budgetBytes * MEM_BLOCK_FRACTION) {
    const deviceNote =
      deviceBytes !== null ? ` · ~${formatBytes(deviceBytes)} device RAM` : "";
    return {
      level: "hard_block",
      message: `Too large for this browser session: est. peak ${est} exceeds budget ${bud}${deviceNote} (${atoms} atoms). Reduce the system or run offline.`,
      estimateBytes,
      budgetBytes,
    };
  }

  if (estimateBytes > budgetBytes * MEM_WARN_FRACTION) {
    return {
      level: "warn",
      message: `${atoms} atoms — est. peak ${est} (budget ${bud}). Optimization may freeze the tab while WASM runs.`,
      estimateBytes,
      budgetBytes,
    };
  }

  if (isMolrsPotential(potential) && n > LBFGS_WARN_ATOMS) {
    const rcut = forceFieldNonbondedCutoff(potential);
    return {
      level: "warn",
      message: `${atoms} atoms — WASM ${String(potential).toUpperCase()} (r_cut=${rcut} Å LinkedCell when past speed crossover) runs in main-thread chunks; expect multi-second steps.`,
      estimateBytes,
      budgetBytes,
    };
  }

  return {
    level: "ok",
    message: "",
    estimateBytes,
    budgetBytes,
  };
}

function formatPairCount(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return String(Math.round(n));
}

/** Default L-BFGS / soft report chunk size so large systems yield more often. */
export function defaultOptimizeReportEvery(
  atomCount: number,
  potential: PotentialKind | string,
): number {
  const n = atomCount;
  if (isMolrsPotential(potential)) {
    // Each LBFGS.run chunk is fully sync on the main thread — prefer 1 step
    // past a few hundred atoms so status/cancel can run between WASM calls.
    if (n > 800) return 1;
    if (n > 200) return 2;
    return 4;
  }
  // Soft: yield every few steps (pair budget is device-scaled, not fixed N).
  if (n > 1_000) return 2;
  if (n > 200) return 1;
  return 1;
}

/** Methods that run through molrs WASM force-field L-BFGS. */
export function isMolrsPotential(
  potential: PotentialKind | string,
): potential is "uff" | "mmff94" | "mmff94s" {
  return (
    potential === "uff" || potential === "mmff94" || potential === "mmff94s"
  );
}

// ---------------------------------------------------------------------------
// Preflight: element / force-field type checks (UI + WASM gate)
// ---------------------------------------------------------------------------

/**
 * Elements MMFF94/s can typify in practice (organic / main-group drug space).
 * Metals and most inorganic ions are out of domain — not a molvis bug.
 */
const MMFF_SUPPORTED_ELEMENTS = new Set([
  "H",
  "B",
  "C",
  "N",
  "O",
  "F",
  "SI",
  "P",
  "S",
  "CL",
  "BR",
  "I",
  "SE",
  "AS",
]);

/** Above this atom count MMFF is almost never the right tool (warn only). */
const MMFF_LARGE_ATOM_WARN = 500;

export type OptimizeTypeRisk = "ok" | "warn" | "block";

export interface OptimizeTypeSample {
  index: number;
  value: string;
}

export interface OptimizeTypeAssessment {
  level: OptimizeTypeRisk;
  /** Full prose for the compute panel (status bar truncates — do not rely on it). */
  message: string;
  /** Discrete issues for multi-line panel rendering. */
  issues: string[];
  atomCount: number;
  missingElementCount: number;
  missingElementSamples: OptimizeTypeSample[];
  /** Element → count for symbols outside MMFF's organic set (empty for UFF/soft). */
  unsupportedForMethod: Record<string, number>;
}

function normalizeElementSymbol(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.trim();
}

/** Canonical uppercase element key: `mg` / `Mg` → `MG`, `cl` → `CL`. */
function elementKey(symbol: string): string {
  const s = symbol.trim();
  if (!s) return "";
  if (s.length === 1) return s.toUpperCase();
  return s[0].toUpperCase() + s.slice(1).toLowerCase();
}

function isInvalidElementSymbol(symbol: string): boolean {
  const el = symbol.trim();
  return !el || el === "?" || el === "-" || /^x{1,2}$/i.test(el);
}

/**
 * Preflight atom elements against the chosen potential.
 * Call from the compute panel **before** starting a run; surface `message` /
 * `issues` in the panel (not only the status bar).
 */
export function assessOptimizeAtomTypes(
  elements: readonly string[],
  potential: PotentialKind | string,
): OptimizeTypeAssessment {
  const n = elements.length;
  const issues: string[] = [];
  const missingSamples: OptimizeTypeSample[] = [];
  let missingCount = 0;
  const unsupported: Record<string, number> = {};

  for (let i = 0; i < n; i++) {
    const raw = normalizeElementSymbol(elements[i]);
    if (isInvalidElementSymbol(raw)) {
      missingCount++;
      if (missingSamples.length < 8) {
        missingSamples.push({ index: i, value: raw === "" ? "(empty)" : raw });
      }
      continue;
    }
    if (potential === "mmff94" || potential === "mmff94s") {
      const key = elementKey(raw);
      // Compare with uppercase form used in the set (MG not Mg).
      const setKey = key.toUpperCase();
      if (!MMFF_SUPPORTED_ELEMENTS.has(setKey)) {
        unsupported[key] = (unsupported[key] ?? 0) + 1;
      }
    }
  }

  if (n === 0) {
    return {
      level: "block",
      message: "No atoms in the current frame — load a structure first.",
      issues: ["No atoms"],
      atomCount: 0,
      missingElementCount: 0,
      missingElementSamples: [],
      unsupportedForMethod: {},
    };
  }

  if (missingCount > 0) {
    const sample = missingSamples
      .map((s) => `#${s.index}=${s.value}`)
      .join(", ");
    const more =
      missingCount > missingSamples.length
        ? ` (+${missingCount - missingSamples.length} more)`
        : "";
    issues.push(
      `Missing/invalid element symbols on ${missingCount} atom(s): ${sample}${more}`,
    );
  }

  const unsupportedTotal = Object.values(unsupported).reduce(
    (a, b) => a + b,
    0,
  );
  if (unsupportedTotal > 0) {
    const parts = Object.entries(unsupported)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([el, c]) => `${el}×${c}`);
    issues.push(
      `${String(potential).toUpperCase()} cannot type ${unsupportedTotal} atom(s) outside its organic set: ${parts.join(", ")}.`,
    );
    issues.push(
      "MMFF94 is for small organics — metals, ions, and most inorganic atoms fail typing. Switch potential to UFF, or remove unsupported atoms.",
    );
  }

  if (
    (potential === "mmff94" || potential === "mmff94s") &&
    n >= MMFF_LARGE_ATOM_WARN &&
    unsupportedTotal === 0 &&
    missingCount === 0
  ) {
    issues.push(
      `${n.toLocaleString()} atoms is far beyond typical MMFF use (drug-like molecules). Prefer UFF for proteins/materials, or isolate a ligand first.`,
    );
  }

  let level: OptimizeTypeRisk = "ok";
  if (missingCount > 0 || unsupportedTotal > 0) {
    level = "block";
  } else if (issues.length > 0) {
    level = "warn";
  }

  const message =
    issues.length === 0
      ? `${n.toLocaleString()} atoms — element symbols OK for ${String(potential).toUpperCase()}.`
      : issues.join(" ");

  return {
    level,
    message,
    issues,
    atomCount: n,
    missingElementCount: missingCount,
    missingElementSamples: missingSamples,
    unsupportedForMethod: unsupported,
  };
}

/**
 * Read `atoms.element` from a molrs Frame and run {@link assessOptimizeAtomTypes}.
 * Does not free the frame. Missing column → block with a clear message.
 */
export function assessFrameForOptimize(
  frame: Frame | null | undefined,
  potential: PotentialKind | string,
): OptimizeTypeAssessment {
  if (!frame) {
    return {
      level: "block",
      message: "No frame loaded — open a structure before optimizing.",
      issues: ["No frame"],
      atomCount: 0,
      missingElementCount: 0,
      missingElementSamples: [],
      unsupportedForMethod: {},
    };
  }
  const atoms = frame.getBlock("atoms");
  try {
    if (!atoms || atoms.nrows() === 0) {
      return assessOptimizeAtomTypes([], potential);
    }
    const n = atoms.nrows();
    let col: string[] | null = null;
    try {
      // molrs throws when the column is absent or not string dtype.
      col = atoms.copyColStr("element");
    } catch {
      col = null;
    }
    if (!col || col.length !== n) {
      return {
        level: "block",
        message:
          "Atoms have no element column. Load a file with element/species symbols, or map atom types to elements before optimizing.",
        issues: ["No element column on atoms block"],
        atomCount: n,
        missingElementCount: n,
        missingElementSamples: [],
        unsupportedForMethod: {},
      };
    }
    return assessOptimizeAtomTypes(col, potential);
  } finally {
    safeFree(atoms);
  }
}

export interface DampedOptimizeInput {
  /** Flat xyz, length 3n. Mutated in place. */
  coords: Float64Array;
  elements: readonly string[];
  /** Bond endpoints as dense atom indices. */
  bonds: ReadonlyArray<readonly [number, number]>;
  /** Bond order ≥ 1; defaults to 1 when omitted. */
  orders?: ReadonlyArray<number>;
  /** Atom indices that must not move. */
  fixed?: ReadonlySet<number> | readonly number[];
  /** Soft spring only; use runLbfgsOptimize for molrs force fields. */
  potential?: "soft";
  maxSteps?: number;
  /** Max per-atom force magnitude to stop (internal energy units / Å). */
  forceTol?: number;
  /**
   * Invoke every `reportEvery` steps (and on the last step). When omitted,
   * reports every step.
   */
  reportEvery?: number;
  /** Optional abort check — return true to stop. */
  shouldCancel?: () => boolean;
  /** Status-bar beats between steps (soft path). */
  onStatus?: OptimizeStatusCallback;
}

export interface OptimizeStep {
  step: number;
  energy: number;
  maxForce: number;
  converged: boolean;
  cancelled: boolean;
  /** Same buffer as input.coords (mutated). */
  coords: Float64Array;
}

export interface OptimizeResult {
  steps: number;
  energy: number;
  maxForce: number;
  converged: boolean;
  cancelled: boolean;
  coords: Float64Array;
}

interface MethodPreset {
  kBond: number;
  kAngle: number;
  kNb: number;
  dt: number;
  damping: number;
}

/** Spring stiffness presets for the client-side `soft` relaxer only. */
const PRESETS: Record<"soft", MethodPreset> = {
  soft: { kBond: 40, kAngle: 8, kNb: 0.6, dt: 0.04, damping: 0.92 },
};

/** Covalent radii (Å) for common elements — Pyykkö & Atsumi style shortcuts. */
const COVALENT: Record<string, number> = {
  H: 0.31,
  C: 0.76,
  N: 0.71,
  O: 0.66,
  F: 0.57,
  P: 1.07,
  S: 1.05,
  Cl: 1.02,
  Br: 1.2,
  I: 1.39,
  B: 0.84,
  Si: 1.11,
  Se: 1.2,
  Li: 1.28,
  Na: 1.66,
  K: 2.03,
  Mg: 1.41,
  Ca: 1.76,
  Fe: 1.32,
  Zn: 1.22,
  Cu: 1.32,
};

function radiusOf(el: string): number {
  const key = el.trim();
  if (!key) return 0.77;
  return (
    COVALENT[key] ??
    COVALENT[key[0].toUpperCase() + key.slice(1).toLowerCase()] ??
    0.77
  );
}

function idealBondLength(elI: string, elJ: string, order: number): number {
  const base = radiusOf(elI) + radiusOf(elJ);
  const o = Number.isFinite(order) && order > 0 ? order : 1;
  // Slightly shorter for higher bond order.
  return base * (1 - 0.08 * Math.min(o - 1, 2));
}

function buildAngles(
  n: number,
  bonds: ReadonlyArray<readonly [number, number]>,
): Array<[number, number, number]> {
  const adj: number[][] = Array.from({ length: n }, () => []);
  for (const [i, j] of bonds) {
    if (i < 0 || j < 0 || i >= n || j >= n || i === j) continue;
    adj[i].push(j);
    adj[j].push(i);
  }
  const angles: Array<[number, number, number]> = [];
  for (let j = 0; j < n; j++) {
    const nbr = adj[j];
    for (let a = 0; a < nbr.length; a++) {
      for (let b = a + 1; b < nbr.length; b++) {
        angles.push([nbr[a], j, nbr[b]]);
      }
    }
  }
  return angles;
}

function is1_2or1_3(
  i: number,
  j: number,
  bonded: Set<string>,
  adj: number[][],
): boolean {
  const key = i < j ? `${i}-${j}` : `${j}-${i}`;
  if (bonded.has(key)) return true;
  for (const mid of adj[i]) {
    if (mid === j) return true;
    const k2 = mid < j ? `${mid}-${j}` : `${j}-${mid}`;
    if (bonded.has(k2)) return true;
  }
  return false;
}

function forceEnergy(
  coords: Float64Array,
  n: number,
  elements: readonly string[],
  bonds: ReadonlyArray<readonly [number, number]>,
  orders: ReadonlyArray<number> | undefined,
  angles: Array<[number, number, number]>,
  adj: number[][],
  bonded: Set<string>,
  free: boolean[],
  preset: MethodPreset,
  fx: Float64Array,
  fy: Float64Array,
  fz: Float64Array,
): { energy: number; maxForce: number } {
  fx.fill(0);
  fy.fill(0);
  fz.fill(0);
  let energy = 0;

  // Bonds
  for (let b = 0; b < bonds.length; b++) {
    const i = bonds[b][0];
    const j = bonds[b][1];
    if (i < 0 || j < 0 || i >= n || j >= n || i === j) continue;
    const ix = i * 3;
    const jx = j * 3;
    const dx = coords[jx] - coords[ix];
    const dy = coords[jx + 1] - coords[ix + 1];
    const dz = coords[jx + 2] - coords[ix + 2];
    const r = Math.hypot(dx, dy, dz);
    if (r < 1e-8) continue;
    const r0 = idealBondLength(elements[i], elements[j], orders?.[b] ?? 1);
    const dr = r - r0;
    energy += 0.5 * preset.kBond * dr * dr;
    const f = (preset.kBond * dr) / r;
    const fxb = f * dx;
    const fyb = f * dy;
    const fzb = f * dz;
    if (free[i]) {
      fx[i] += fxb;
      fy[i] += fyb;
      fz[i] += fzb;
    }
    if (free[j]) {
      fx[j] -= fxb;
      fy[j] -= fyb;
      fz[j] -= fzb;
    }
  }

  // Angles (target 109.5° for tetrahedral-ish, 120° for 3-coord, 180° for 2-linear)
  for (const [i, j, k] of angles) {
    const jx = j * 3;
    const ix = i * 3;
    const kx = k * 3;
    const vix = coords[ix] - coords[jx];
    const viy = coords[ix + 1] - coords[jx + 1];
    const viz = coords[ix + 2] - coords[jx + 2];
    const vkx = coords[kx] - coords[jx];
    const vky = coords[kx + 1] - coords[jx + 1];
    const vkz = coords[kx + 2] - coords[jx + 2];
    const ri = Math.hypot(vix, viy, viz);
    const rk = Math.hypot(vkx, vky, vkz);
    if (ri < 1e-8 || rk < 1e-8) continue;
    const cos = Math.max(
      -1,
      Math.min(1, (vix * vkx + viy * vky + viz * vkz) / (ri * rk)),
    );
    const theta = Math.acos(cos);
    const degree = adj[j].length;
    const theta0 =
      degree <= 2 ? Math.PI : degree === 3 ? (2 * Math.PI) / 3 : 1.910633;
    const dTheta = theta - theta0;
    energy += 0.5 * preset.kAngle * dTheta * dTheta;
    // Soft Cartesian forces along the plane normal cross products.
    const sin = Math.sin(theta);
    if (sin < 1e-6) continue;
    const fmag = (preset.kAngle * dTheta) / sin;
    // d(cos)/d vi ~ (vk/|vk| - cos * vi/|vi|) / |vi|
    const cix = (vkx / rk - cos * (vix / ri)) / ri;
    const ciy = (vky / rk - cos * (viy / ri)) / ri;
    const ciz = (vkz / rk - cos * (viz / ri)) / ri;
    const ckx = (vix / ri - cos * (vkx / rk)) / rk;
    const cky = (viy / ri - cos * (vky / rk)) / rk;
    const ckz = (viz / ri - cos * (vkz / rk)) / rk;
    // Force is -dE/dx = -k*dTheta * dTheta/dx; dTheta/dcos = -1/sin
    // so -k*dTheta*(-1/sin)*dcos = (k*dTheta/sin)*dcos = fmag * dcos
    if (free[i]) {
      fx[i] += fmag * cix;
      fy[i] += fmag * ciy;
      fz[i] += fmag * ciz;
    }
    if (free[k]) {
      fx[k] += fmag * ckx;
      fy[k] += fmag * cky;
      fz[k] += fmag * ckz;
    }
    if (free[j]) {
      fx[j] -= fmag * (cix + ckx);
      fy[j] -= fmag * (ciy + cky);
      fz[j] -= fmag * (ciz + ckz);
    }
  }

  // Soft nonbonded repulsion (exclude 1-2 / 1-3)
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (is1_2or1_3(i, j, bonded, adj)) continue;
      const ix = i * 3;
      const jx = j * 3;
      const dx = coords[jx] - coords[ix];
      const dy = coords[jx + 1] - coords[ix + 1];
      const dz = coords[jx + 2] - coords[ix + 2];
      const r2 = dx * dx + dy * dy + dz * dz;
      const sigma = 0.9 * (radiusOf(elements[i]) + radiusOf(elements[j]));
      const cut = sigma * 1.6;
      if (r2 > cut * cut || r2 < 1e-12) continue;
      const r = Math.sqrt(r2);
      // Soft wall: k/2 * (sigma - r)^2 for r < sigma
      if (r >= sigma) continue;
      const dr = sigma - r;
      energy += 0.5 * preset.kNb * dr * dr;
      const f = (preset.kNb * dr) / r;
      const fxb = f * dx;
      const fyb = f * dy;
      const fzb = f * dz;
      if (free[i]) {
        fx[i] -= fxb;
        fy[i] -= fyb;
        fz[i] -= fzb;
      }
      if (free[j]) {
        fx[j] += fxb;
        fy[j] += fyb;
        fz[j] += fzb;
      }
    }
  }

  let maxForce = 0;
  for (let i = 0; i < n; i++) {
    if (!free[i]) continue;
    const mag = Math.hypot(fx[i], fy[i], fz[i]);
    if (mag > maxForce) maxForce = mag;
  }
  return { energy, maxForce };
}

/**
 * Client-side damped steepest-descent soft spring relaxer (potential `soft` + optimizer `damped`).
 * Mutates `input.coords`. Real force fields use
 * {@link runLbfgsOptimize} (Typifier → LBFGS).
 */
export async function runDampedOptimize(
  input: DampedOptimizeInput,
  onStep?: (step: OptimizeStep) => void | Promise<void>,
): Promise<OptimizeResult> {
  const coords = input.coords;
  const n = input.elements.length;
  if (coords.length < n * 3) {
    throw new Error(`coords length ${coords.length} < 3 * nAtoms (${n})`);
  }
  if (n === 0) {
    return {
      steps: 0,
      energy: 0,
      maxForce: 0,
      converged: true,
      cancelled: false,
      coords,
    };
  }

  const potential = input.potential ?? "soft";
  if (potential !== "soft") {
    throw new Error(
      `runDampedOptimize only accepts potential 'soft' (got '${potential}'); ` +
        `use runLbfgsOptimize for UFF/MMFF`,
    );
  }
  const sizeRisk = assessOptimizeSize(n, "soft");
  if (sizeRisk.level === "soft_block" || sizeRisk.level === "hard_block") {
    throw new Error(sizeRisk.message);
  }
  const preset = PRESETS.soft;
  const maxSteps = Math.max(1, Math.floor(input.maxSteps ?? 200));
  const forceTol = Math.max(1e-6, input.forceTol ?? 0.05);
  const reportEvery = Math.max(
    1,
    Math.floor(input.reportEvery ?? defaultOptimizeReportEvery(n, "soft")),
  );
  input.onStatus?.({
    phase: "minimize",
    message: `Soft relax… step 0/${maxSteps}`,
    progress: 0,
    step: 0,
    maxSteps,
  });

  const fixed = new Set<number>(
    input.fixed instanceof Set ? input.fixed : (input.fixed ?? []),
  );
  const free = Array.from({ length: n }, (_, i) => !fixed.has(i));

  const adj: number[][] = Array.from({ length: n }, () => []);
  const bonded = new Set<string>();
  for (const [i, j] of input.bonds) {
    if (i < 0 || j < 0 || i >= n || j >= n || i === j) continue;
    adj[i].push(j);
    adj[j].push(i);
    bonded.add(i < j ? `${i}-${j}` : `${j}-${i}`);
  }
  const angles = buildAngles(n, input.bonds);

  const fx = new Float64Array(n);
  const fy = new Float64Array(n);
  const fz = new Float64Array(n);
  const vx = new Float64Array(n);
  const vy = new Float64Array(n);
  const vz = new Float64Array(n);

  let energy = 0;
  let maxForce = 0;
  let converged = false;
  let cancelled = false;
  let stepsDone = 0;

  for (let step = 1; step <= maxSteps; step++) {
    if (input.shouldCancel?.()) {
      cancelled = true;
      stepsDone = step - 1;
      break;
    }

    const fe = forceEnergy(
      coords,
      n,
      input.elements,
      input.bonds,
      input.orders,
      angles,
      adj,
      bonded,
      free,
      preset,
      fx,
      fy,
      fz,
    );
    energy = fe.energy;
    maxForce = fe.maxForce;
    stepsDone = step;

    if (maxForce < forceTol) {
      converged = true;
      if (onStep) {
        await onStep({
          step,
          energy,
          maxForce,
          converged: true,
          cancelled: false,
          coords,
        });
      }
      break;
    }

    const dt = preset.dt;
    const damp = preset.damping;
    for (let i = 0; i < n; i++) {
      if (!free[i]) continue;
      vx[i] = damp * vx[i] + dt * fx[i];
      vy[i] = damp * vy[i] + dt * fy[i];
      vz[i] = damp * vz[i] + dt * fz[i];
      // Cap per-step displacement for stability.
      const speed = Math.hypot(vx[i], vy[i], vz[i]);
      const maxStep = 0.15;
      const scale = speed > maxStep ? maxStep / speed : 1;
      coords[i * 3] += scale * vx[i] * dt;
      coords[i * 3 + 1] += scale * vy[i] * dt;
      coords[i * 3 + 2] += scale * vz[i] * dt;
    }

    if (step % reportEvery === 0 || step === maxSteps) {
      input.onStatus?.({
        phase: "minimize",
        message: `Soft relax… step ${step}/${maxSteps}`,
        progress: Math.round((step / maxSteps) * 100),
        step,
        maxSteps,
      });
      if (onStep) {
        await onStep({
          step,
          energy,
          maxForce,
          converged: false,
          cancelled: false,
          coords,
        });
      }
      await yieldToUi();
    }
  }

  if (!cancelled && !converged) {
    const fe = forceEnergy(
      coords,
      n,
      input.elements,
      input.bonds,
      input.orders,
      angles,
      adj,
      bonded,
      free,
      preset,
      fx,
      fy,
      fz,
    );
    energy = fe.energy;
    maxForce = fe.maxForce;
  }

  return {
    steps: stepsDone,
    energy,
    maxForce,
    converged,
    cancelled,
    coords,
  };
}

/** Pack separate x/y/z columns into a flat xyz buffer. */
export function packCoords(
  x: ArrayLike<number>,
  y: ArrayLike<number>,
  z: ArrayLike<number>,
): Float64Array {
  const n = x.length;
  const out = new Float64Array(n * 3);
  for (let i = 0; i < n; i++) {
    out[i * 3] = x[i];
    out[i * 3 + 1] = y[i];
    out[i * 3 + 2] = z[i];
  }
  return out;
}

export interface LbfgsOptimizeInput {
  /** Working Frame with atoms.x/y/z and bonds (atomi/atomj). Mutated in place. */
  frame: Frame;
  potential: "uff" | "mmff94" | "mmff94s";
  maxSteps?: number;
  forceTol?: number;
  fixed?: ReadonlySet<number> | readonly number[];
  /**
   * L-BFGS steps per chunk so the UI can stream coords. Defaults scale with
   * atom count. Each chunk re-typifies (topology is fixed; cost is acceptable
   * for interactive molecules).
   */
  reportEvery?: number;
  shouldCancel?: () => boolean;
  /** Status-bar beats during typify / potentials / L-BFGS chunks. */
  onStatus?: OptimizeStatusCallback;
}

function readPackedCoords(frame: Frame): {
  n: number;
  coords: Float64Array;
} {
  const atoms = frame.getBlock("atoms");
  try {
    if (!atoms || atoms.nrows() === 0) {
      return { n: 0, coords: new Float64Array(0) };
    }
    const n = atoms.nrows();
    const x = atoms.copyColF("x");
    const y = atoms.copyColF("y");
    const z = atoms.copyColF("z");
    if (!x || !y || !z) {
      throw new Error("atoms lost x/y/z coordinates");
    }
    return { n, coords: packCoords(x, y, z) };
  } finally {
    // Drop the transient Block handle immediately — do not keep it across
    // WASM calls that may re-borrow the same frame.
    safeFree(atoms);
  }
}

/** Copy atoms.x/y/z from `src` into `dst` (same atom count). */
function copyCoords(src: Frame, dst: Frame): void {
  const s = src.getBlock("atoms");
  const d = dst.getBlock("atoms");
  try {
    if (!s || !d) throw new Error("copyCoords: missing atoms block");
    const x = s.copyColF("x");
    const y = s.copyColF("y");
    const z = s.copyColF("z");
    if (!x || !y || !z) throw new Error("copyCoords: missing x/y/z");
    d.setColF("x", x);
    d.setColF("y", y);
    d.setColF("z", z);
  } finally {
    safeFree(s);
    safeFree(d);
  }
}

/**
 * Build a typifier for the named potential — mirrors native
 * `UFFTypifier::new()` / `MMFF94Typifier::new()` / `MMFF94STypifier::new()`.
 */
function newTypifier(potential: "mmff94" | "mmff94s" | "uff"): {
  typify: (frame: Frame) => Frame;
  toPotentials: (frame: Frame) => Potentials;
  free: () => void;
} {
  switch (potential) {
    case "uff":
      return new UFFTypifier();
    case "mmff94":
      return new MMFF94Typifier();
    case "mmff94s":
      return new MMFF94STypifier();
  }
}

/**
 * Fail fast with detailed panel-grade messages before molrs typify.
 * Uses the same rules as {@link assessFrameForOptimize}.
 */
function assertElementsForTypify(
  frame: Frame,
  potential: PotentialKind | string,
): void {
  const assessment = assessFrameForOptimize(frame, potential);
  if (assessment.level === "block") {
    throw new Error(assessment.message);
  }
}

/** Enrich molrs typify/setup failures with a method-aware next step. */
function formatForceFieldSetupError(
  potential: "mmff94" | "mmff94s" | "uff",
  raw: string,
): string {
  const msg = raw.trim() || "unknown error";
  if (isWasmPanicMessage(msg)) {
    return (
      `molrs force-field setup (${potential}): WASM aborted (system too large or ` +
      `internal panic). Keep ≤ ${LBFGS_MAX_ATOMS.toLocaleString()} atoms ` +
      `for interactive UFF/MMFF — isolate a subset rather than a full protein.`
    );
  }
  const mmff = potential === "mmff94" || potential === "mmff94s";
  const typing =
    /atom type|unsupported element|missing\/invalid element|element column/i.test(
      msg,
    );
  if (mmff && typing) {
    return (
      `molrs force-field setup (${potential}): ${msg}. ` +
      "MMFF94 covers organic main-group types only — proteins with metals, " +
      "missing elements, or nonstandard residues often fail. Switch potential to UFF, " +
      "or fix atom element symbols and bonds."
    );
  }
  if (potential === "uff" && typing) {
    return (
      `molrs force-field setup (${potential}): ${msg}. ` +
      "Check that every atom has a valid element symbol and bond topology."
    );
  }
  return `molrs force-field setup (${potential}): ${msg}`;
}

function isWasmPanicMessage(msg: string): boolean {
  return (
    /unreachable|attempted to take ownership of Rust value while it was borrowed|RuntimeError/i.test(
      msg,
    ) || msg === "unreachable"
  );
}

function formatLbfgsRunError(
  potential: "mmff94" | "mmff94s" | "uff",
  err: unknown,
  atomCount: number,
): Error {
  const raw =
    err instanceof Error
      ? err.message
      : typeof err === "string"
        ? err
        : String(err);
  if (isWasmPanicMessage(raw)) {
    return new Error(
      `molrs LBFGS.run (${potential}) aborted on ${atomCount.toLocaleString()} atoms ` +
        `(WASM panic). This is usually OOM from an all-pairs nonbonded table — ` +
        `ensure a neighbor list is used, or reduce the system.`,
    );
  }
  return new Error(
    `molrs LBFGS.run (${potential}): ${raw.trim() || "unknown error"}`,
  );
}

/**
 * Real force-field L-BFGS via molrs WASM:
 *
 * ```
 * typed = typifier.typify(frame)
 * pots  = typifier.toPotentials(typed)
 * strategy = LbfgsNeighborStrategy.forMethod(potential, N, { hasPeriodicBox })
 * // each chunk:
 * prep = strategy.prepare(typed)
 * opt  = prep.createLbfgs(pots, fmax)   // omit NL → bruteforce; else LinkedCell
 * ```
 *
 * Mutates `input.frame` coordinates. Rebuilds LinkedCell pairs each chunk when
 * that algorithm is selected.
 */
export async function runLbfgsOptimize(
  input: LbfgsOptimizeInput,
  onStep?: (step: OptimizeStep) => void | Promise<void>,
): Promise<OptimizeResult> {
  const working = input.frame;
  const initial = readPackedCoords(working);
  if (initial.n === 0) {
    return {
      steps: 0,
      energy: 0,
      maxForce: 0,
      converged: true,
      cancelled: false,
      coords: initial.coords,
    };
  }

  const n = initial.n;
  const sizeRisk = assessOptimizeSize(n, input.potential);
  if (sizeRisk.level === "hard_block" || sizeRisk.level === "soft_block") {
    throw new Error(sizeRisk.message);
  }

  const maxSteps = Math.max(1, Math.floor(input.maxSteps ?? 200));
  const forceTol = Math.max(1e-8, input.forceTol ?? 0.05);
  const reportEvery = Math.max(
    1,
    Math.floor(
      input.reportEvery ?? defaultOptimizeReportEvery(n, input.potential),
    ),
  );

  // frame.box is undefined when absent; getter returns an owned copy when set.
  // Real cells only (shouldDrawBox) — not cryo-EM 1×1×1 placeholders.
  const box = working.box;
  let hasPeriodicBox = false;
  let boxVolume: number | null = null;
  if (shouldDrawBox(box)) {
    hasPeriodicBox = true;
    boxVolume = box.volume();
  }
  box?.free();

  const neighborStrategy = LbfgsNeighborStrategy.forMethod(input.potential, n, {
    hasPeriodicBox,
    boxVolume,
  });

  const fixedList =
    input.fixed instanceof Set ? [...input.fixed] : [...(input.fixed ?? [])];
  const fixedArr =
    fixedList.length > 0
      ? Uint32Array.from(fixedList.filter((i) => i >= 0 && i < n))
      : null;

  // Partial setup handles — free on failure; on success reassigned to locals.
  let setupTypifier: ReturnType<typeof newTypifier> | null = null;
  let setupTyped: Frame | null = null;
  let setupPots: Potentials | null = null;
  try {
    input.onStatus?.({
      phase: "prepare",
      message: `Typifying atoms (${String(input.potential).toUpperCase()})…`,
      progress: 2,
    });
    await yieldToUi();
    // Preflight: empty/"-"/"X" elements and MMFF-out-of-domain metals.
    assertElementsForTypify(working, input.potential);
    setupTypifier = newTypifier(input.potential);
    // Heavy sync WASM — yield before/after so the status bar can paint.
    setupTyped = setupTypifier.typify(working);
    await yieldToUi();
    input.onStatus?.({
      phase: "prepare",
      message: `Building potentials (${String(input.potential).toUpperCase()})…`,
      progress: 5,
    });
    await yieldToUi();
    setupPots = setupTypifier.toPotentials(setupTyped);
    await yieldToUi();
  } catch (err) {
    // Setup failed before the main finally — free any partial sink handles.
    safeFree(setupPots);
    safeFree(setupTyped);
    safeFree(setupTypifier);
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(formatForceFieldSetupError(input.potential, msg));
  }

  // Durable handles for the minimize phase (setup owns them until finally).
  if (!setupTypifier || !setupTyped || !setupPots) {
    throw new Error(
      formatForceFieldSetupError(input.potential, "incomplete typifier setup"),
    );
  }
  const typifier = setupTypifier;
  const typed = setupTyped;
  const pots = setupPots;

  let totalSteps = 0;
  let energy = 0;
  let maxForce = Number.POSITIVE_INFINITY;
  let converged = false;
  let cancelled = false;
  let coords = initial.coords;

  const nlLabel =
    neighborStrategy.algorithm === "bruteforce"
      ? `BruteForce ${neighborStrategy.cutoff} Å`
      : `LinkedCell ${neighborStrategy.cutoff} Å`;

  try {
    input.onStatus?.({
      phase: "minimize",
      message: `L-BFGS (${String(input.potential).toUpperCase()}, ${nlLabel})… step 0/${maxSteps}`,
      progress: 8,
      step: 0,
      maxSteps,
    });
    await yieldToUi();

    // Always rebuild spatial NL each chunk (pairs track moving coords).
    // Frontend never omits the list — always BruteForce or LinkedCell.
    while (totalSteps < maxSteps) {
      if (input.shouldCancel?.()) {
        cancelled = true;
        break;
      }

      const chunk = Math.min(reportEvery, maxSteps - totalSteps);
      const prep = neighborStrategy.prepare(typed);
      let opt: LBFGS | null = null;
      let report: {
        steps: number;
        energy: number;
        maxForce: number;
        converged: boolean;
        free: () => void;
      } | null = null;
      try {
        opt = prep.createLbfgs(pots, forceTol);
        report = opt.run(typed, chunk, fixedArr);
      } catch (err) {
        throw formatLbfgsRunError(input.potential, err, n);
      } finally {
        safeFree(opt);
        prep.free();
      }

      if (!report) {
        throw formatLbfgsRunError(input.potential, "empty OptReport", n);
      }

      try {
        const took = Math.max(0, report.steps | 0);
        totalSteps += took > 0 ? took : chunk;
        energy = report.energy;
        maxForce = report.maxForce;
        converged = report.converged;

        copyCoords(typed, working);
        coords = readPackedCoords(working).coords;

        const pct = Math.min(99, 8 + Math.round((totalSteps / maxSteps) * 90));
        input.onStatus?.({
          phase: "minimize",
          message: `L-BFGS (${String(input.potential).toUpperCase()}, ${nlLabel})… step ${totalSteps}/${maxSteps}`,
          progress: pct,
          step: totalSteps,
          maxSteps,
        });

        if (onStep) {
          await onStep({
            step: totalSteps,
            energy,
            maxForce,
            converged,
            cancelled: false,
            coords,
          });
        }

        if (converged || took === 0) {
          break;
        }
      } finally {
        safeFree(report);
      }

      await yieldToUi();
    }
  } finally {
    safeFree(pots);
    safeFree(typed);
    safeFree(typifier);
  }

  return {
    steps: totalSteps,
    energy,
    maxForce: Number.isFinite(maxForce) ? maxForce : 0,
    converged,
    cancelled,
    coords,
  };
}

/** Unpack flat xyz into separate columns (writes into provided arrays). */
export function unpackCoords(
  coords: Float64Array,
  x: Float64Array,
  y: Float64Array,
  z: Float64Array,
): void {
  const n = x.length;
  for (let i = 0; i < n; i++) {
    x[i] = coords[i * 3];
    y[i] = coords[i * 3 + 1];
    z[i] = coords[i * 3 + 2];
  }
}
