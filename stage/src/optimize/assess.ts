/**
 * Optimize preflight: pairing, size/type gates, error classification.
 * No L-BFGS / damped loops and no neighbor-list construction — those stay
 * in {@link ./relax} on the compute worker.
 */

import type { Frame } from "@molcrafts/molvis-core/molrs";

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
 * Optimizers that pair with `potential` today.
 * Force fields → L-BFGS; soft springs → damped steepest descent.
 */
export function optimizersForPotential(
  potential: PotentialKind,
): readonly OptimizerKind[] {
  return potential === "soft" ? (["damped"] as const) : (["lbfgs"] as const);
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

/**
 * No status beat for this long → page may prompt Continue / Cancel.
 * Must exceed a single long WASM chunk (bond perceive / typify on large N)
 * and first-time worker module load. Heartbeats from the host reset this.
 */
export const OPTIMIZE_STALL_MS = 120_000;

/**
 * Interactive hard cap for WASM force-field L-BFGS (LinkedCell path).
 * BruteForce NeighborList is used below the speed crossover; LinkedCell above.
 */
export const LBFGS_MAX_ATOMS = 80_000;

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
        message:
          `Soft springs are too slow for ${atoms} atoms on this device ` +
          `(~${formatPairCount(pairs)} interactions/step; budget ~${formatPairCount(pairBudget)}). ` +
          `Switch to UFF or MMFF94, or select a smaller region.`,
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
        message:
          `Soft springs on ${atoms} atoms will take a long time and may freeze the tab. ` +
          `Consider UFF / MMFF94 or a smaller selection.`,
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
        `${atoms} atoms is too large for interactive force-field minimize in the browser ` +
        `(limit ${LBFGS_MAX_ATOMS.toLocaleString()}). Select a smaller region, or run offline.`,
      estimateBytes,
      budgetBytes,
    };
  }

  if (estimateBytes > budgetBytes * MEM_BLOCK_FRACTION) {
    const deviceNote =
      deviceBytes !== null ? ` (~${formatBytes(deviceBytes)} RAM)` : "";
    return {
      level: "hard_block",
      message:
        `${atoms} atoms needs more memory than this browser session allows ` +
        `(est. ${est}, budget ${bud}${deviceNote}). Reduce the system or run offline.`,
      estimateBytes,
      budgetBytes,
    };
  }

  if (estimateBytes > budgetBytes * MEM_WARN_FRACTION) {
    return {
      level: "warn",
      message:
        `Large job (${atoms} atoms): minimize may freeze the tab for a while. ` +
        `You can cancel from the panel if it stalls.`,
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
      issues: ["No atoms in the current frame — load a structure first."],
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
      issues: ["No frame loaded — open a structure before optimizing."],
      atomCount: 0,
      missingElementCount: 0,
      missingElementSamples: [],
      unsupportedForMethod: {},
    };
  }
  const atoms = frame.getBlock("atoms");
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

export type OptimizeFailureClass =
  | "neighborlist_overflow"
  | "bad_chemical_topology"
  | "unknown";

export function classifyOptimizeFailure(raw: string): OptimizeFailureClass {
  const m = raw.trim();
  if (
    /capacity overflow|out of memory|OOM|allocation|too many pairs|neighbor/i.test(
      m,
    )
  ) {
    return "neighborlist_overflow";
  }
  if (
    /atom type|parameters missing|unsupported element|missing\/invalid element|element column|topology|bond|valence|typif/i.test(
      m,
    )
  ) {
    return "bad_chemical_topology";
  }
  // Bare WASM traps during setup are almost always topology/typing; during
  // LBFGS.run they may be either — callers pass phase context when known.
  return "unknown";
}

/** Enrich molrs typify/setup failures with a method-aware next step. */
export function formatForceFieldSetupError(
  potential: "mmff94" | "mmff94s" | "uff",
  raw: string,
): string {
  const msg = raw.trim() || "unknown error";
  const kind = classifyOptimizeFailure(msg);
  if (isWasmPanicMessage(msg) || kind === "neighborlist_overflow") {
    if (kind === "neighborlist_overflow") {
      return (
        `NeighborList overflow during ${potential} setup (${msg}). ` +
        `Nonbonded pair table grew too large — check cutoff / density, or reduce the system.`
      );
    }
    // Setup path: typify / toPotentials → chemical topology, not NL.
    return (
      `Bad chemical topology during ${potential} setup (${msg}). ` +
      `Check element symbols, bond graph, and force-field typing.`
    );
  }
  const mmff = potential === "mmff94" || potential === "mmff94s";
  const typing =
    /atom type|unsupported element|missing\/invalid element|element column|parameters missing/i.test(
      msg,
    );
  if (mmff && typing) {
    return (
      `Bad chemical topology (${potential}): ${msg}. ` +
      "MMFF94 covers organic main-group types only — proteins with metals, " +
      "missing elements, or nonstandard residues often fail. Switch potential to UFF, " +
      "or fix atom element symbols and bonds."
    );
  }
  if (potential === "uff" && typing) {
    return (
      `Bad chemical topology (${potential}): ${msg}. ` +
      "Check element symbols and the bond topology used for typing."
    );
  }
  if (kind === "bad_chemical_topology") {
    return `Bad chemical topology (${potential}): ${msg}`;
  }
  return `molrs force-field setup (${potential}): ${msg}`;
}

function isWasmPanicMessage(msg: string): boolean {
  const m = msg.trim();
  if (!m) return false;
  return (
    m === "unreachable" ||
    /unreachable|attempted to take ownership of Rust value while it was borrowed|WebAssembly\.RuntimeError|RuntimeError/i.test(
      m,
    )
  );
}

/** True for WASM trap / poisoned-handle panics (message or Error name). */
export function isWasmPanic(err: unknown): boolean {
  if (err instanceof Error) {
    if (
      err.name === "RuntimeError" ||
      err.name === "WebAssembly.RuntimeError"
    ) {
      return true;
    }
    if (isWasmPanicMessage(err.message)) return true;
    // Some hosts put the trap only in stack / toString.
    if (isWasmPanicMessage(String(err))) return true;
    return false;
  }
  return isWasmPanicMessage(String(err));
}

/**
 * Human message for any optimize failure shown in the panel / status bar.
 * Never leave raw `unreachable` as the only text.
 *
 * Failure classes (product):
 * - NeighborList overflow — nonbonded pair table
 * - Bad chemical topology — bonds / types / FF parameters
 */
export function formatOptimizeError(err: unknown): string {
  if (err instanceof Error) {
    const m = err.message.trim();
    // Already classified by setup/run formatters.
    if (
      m.startsWith("NeighborList overflow") ||
      m.startsWith("Bad chemical topology") ||
      m.startsWith("molrs LBFGS.run") ||
      m.startsWith("molrs force-field setup")
    ) {
      return m;
    }
    if (m && !isWasmPanicMessage(m) && m !== "unreachable") {
      const kind = classifyOptimizeFailure(m);
      if (kind === "neighborlist_overflow") {
        return `NeighborList overflow: ${m}`;
      }
      if (kind === "bad_chemical_topology") {
        return `Bad chemical topology: ${m}`;
      }
      return m;
    }
    if (isWasmPanic(err) || m === "unreachable") {
      // Bare trap with no phase context — list both product classes.
      return (
        "Optimization aborted (WASM trap). Possible causes: " +
        "NeighborList overflow (nonbonded pairs), or bad chemical topology " +
        "(bonds / atom types / force-field parameters)."
      );
    }
    return m || "Optimization failed";
  }
  if (isWasmPanic(err) || String(err).trim() === "unreachable") {
    return (
      "Optimization aborted (WASM trap). Possible causes: " +
      "NeighborList overflow (nonbonded pairs), or bad chemical topology " +
      "(bonds / atom types / force-field parameters)."
    );
  }
  const s = String(err).trim();
  return s || "Optimization failed";
}

export function formatLbfgsRunError(
  potential: "mmff94" | "mmff94s" | "uff",
  err: unknown,
  atomCount: number,
): Error {
  const raw =
    err instanceof Error
      ? err.message || err.name
      : typeof err === "string"
        ? err
        : String(err);
  const kind = classifyOptimizeFailure(raw);
  if (isWasmPanic(err) || kind === "neighborlist_overflow") {
    if (kind === "bad_chemical_topology") {
      return new Error(
        `Bad chemical topology during ${potential} minimize ` +
          `(${atomCount.toLocaleString()} atoms): ${raw}`,
      );
    }
    // LBFGS.run is nonbonded-heavy; default bare traps to NeighborList overflow.
    return new Error(
      `NeighborList overflow during ${potential} minimize ` +
        `(${atomCount.toLocaleString()} atoms): ${raw.trim() || "WASM trap"}. ` +
        `Nonbonded pair table too large for this cutoff/density.`,
    );
  }
  if (kind === "bad_chemical_topology") {
    return new Error(
      `Bad chemical topology during ${potential} minimize: ${raw}`,
    );
  }
  return new Error(
    `molrs LBFGS.run (${potential}): ${raw.trim() || "unknown error"}`,
  );
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
