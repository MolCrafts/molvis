/**
 * Optimize runners: L-BFGS (molrs force fields) and damped soft springs.
 * Preflight / pairing / error text live in {@link ./assess}.
 */

import {
  type Frame,
  type LBFGS,
  MMFF94STypifier,
  MMFF94Typifier,
  type Potentials,
  UFFTypifier,
} from "@molcrafts/molvis-core/molrs";
import { LbfgsNeighborStrategy } from "../algo/neighbor_list";
import { shouldDrawBox } from "../io/box_presence";
import {
  safeFree,
  yieldForPaint,
  yieldToUi as yieldUi,
} from "../utils/yield_ui";
import {
  assessFrameForOptimize,
  assessOptimizeSize,
  defaultOptimizeReportEvery,
  formatForceFieldSetupError,
  formatLbfgsRunError,
  isWasmPanic,
  type OptimizeStatusCallback,
  type PotentialKind,
  packCoords,
} from "./assess";

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
      await yieldUi();
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
}

/** Copy atoms.x/y/z from `src` into `dst` (same atom count). */
function copyCoords(src: Frame, dst: Frame): void {
  const s = src.getBlock("atoms");
  const d = dst.getBlock("atoms");
  if (!s || !d) throw new Error("copyCoords: missing atoms block");
  const x = s.copyColF("x");
  const y = s.copyColF("y");
  const z = s.copyColF("z");
  if (!x || !y || !z) throw new Error("copyCoords: missing x/y/z");
  d.setColF("x", x);
  d.setColF("y", y);
  d.setColF("z", z);
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

  // PBC policy = shouldDrawBox only. molrs reads frame.box whenever set; if
  // the product treats the cell as non-PBC, clear it on this owned working
  // copy so NeighborList (nonbonded) and the rest of LBFGS agree. HEAD/scene
  // are not mutated (we already work on a sink copy).
  const boxCopy = working.box;
  let hasPeriodicBox = false;
  let boxVolume: number | null = null;
  try {
    if (shouldDrawBox(boxCopy)) {
      hasPeriodicBox = true;
      boxVolume = boxCopy.volume();
    } else if (boxCopy) {
      working.box = undefined;
    }
  } finally {
    safeFree(boxCopy);
  }

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
      message: `Assigning ${String(input.potential).toUpperCase()} atom types (${n.toLocaleString()} atoms)…`,
    });
    await yieldForPaint();
    // Preflight: empty/"-"/"X" elements and MMFF-out-of-domain metals.
    assertElementsForTypify(working, input.potential);
    setupTypifier = newTypifier(input.potential);
    setupTyped = setupTypifier.typify(working);
    await yieldUi();
    input.onStatus?.({
      phase: "prepare",
      message: `Building ${String(input.potential).toUpperCase()} force field…`,
    });
    await yieldForPaint();
    setupPots = setupTypifier.toPotentials(setupTyped);
    await yieldUi();
  } catch (err) {
    // Setup failed before the main finally — free any partial sink handles.
    safeFree(setupPots);
    safeFree(setupTyped);
    safeFree(setupTypifier);
    if (isWasmPanic(err)) {
      throw new Error(
        formatForceFieldSetupError(input.potential, "unreachable"),
      );
    }
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

  try {
    input.onStatus?.({
      phase: "minimize",
      message: `Minimizing (${String(input.potential).toUpperCase()})… step 0/${maxSteps}`,
      step: 0,
      maxSteps,
    });
    await yieldForPaint();

    // Always rebuild spatial NL each chunk (pairs track moving coords).
    // Frontend never omits the list — always BruteForce or LinkedCell.
    while (totalSteps < maxSteps) {
      if (input.shouldCancel?.()) {
        cancelled = true;
        break;
      }

      const chunk = Math.min(reportEvery, maxSteps - totalSteps);
      let prep: ReturnType<LbfgsNeighborStrategy["prepare"]> | null = null;
      let opt: LBFGS | null = null;
      let report: {
        steps: number;
        energy: number;
        maxForce: number;
        converged: boolean;
        free: () => void;
      } | null = null;
      try {
        prep = neighborStrategy.prepare(typed);
        opt = prep.createLbfgs(pots, forceTol);
        report = opt.run(typed, chunk, fixedArr);
      } catch (err) {
        throw formatLbfgsRunError(input.potential, err, n);
      } finally {
        safeFree(opt);
        if (prep) prep.free();
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

        // Prep used ~0–22%; leave headroom to 99 for finalize.
        const pct = Math.min(98, 22 + Math.round((totalSteps / maxSteps) * 76));
        input.onStatus?.({
          phase: "minimize",
          message: `Minimizing (${String(input.potential).toUpperCase()})… step ${totalSteps}/${maxSteps}`,
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

      await yieldUi();
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
