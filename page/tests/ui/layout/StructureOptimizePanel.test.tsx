import {
  type Molvis,
  type OptimizeOptions,
  type OptimizeOutcome,
  UnsavedSceneError,
} from "@molcrafts/molvis-stage";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  rstest,
} from "@rstest/core";
import { act } from "react";
import {
  OPTIMIZE_DIRTY_GATE_HINT,
  optimizeStagedLine,
} from "../../../src/lib/optimize-staging-copy";
import { mountComponent } from "../../react_harness";
import { readEmptyState } from "./empty_state_probe";

/**
 * Empty = title only (`.claude/notes/compute-form-design.md`, spec ac-002 —
 * Optimize is on the baseline panel list for "run bar / empty / density").
 * Optimize is the one compute panel with no result-absent empty state at all:
 * before the first run it shows the form and nothing else, so the shared
 * anatomy (… → result) has no idle rung here.
 */

type Listener = (...args: never[]) => void;

interface FakeBlock {
  nrows: () => number;
  copyColStr: (column: string) => string[];
}

interface FakeFrame {
  getBlock: (name: string) => FakeBlock | undefined;
}

interface FakeSelectionManager {
  getState: () => { atoms: Set<number>; bonds: Set<number>; revision: number };
  on: (event: string, listener: Listener) => void;
  off: (event: string, listener: Listener) => void;
}

interface FakeMolvis {
  readonly system: { frame: FakeFrame };
  readonly world: {
    sceneIndex: { hasUnsavedChanges: boolean };
    selectionManager: FakeSelectionManager;
  };
  readonly events: {
    on: (event: string, listener: Listener) => () => void;
    emit: (event: string, payload: unknown) => void;
  };
}

const ATOMS: FakeBlock = {
  nrows: () => 3,
  copyColStr: (column) => {
    // molrs throws for an absent / non-string column; only "element" is read.
    if (column !== "element") throw new Error(`no string column ${column}`);
    return ["C", "C", "H"];
  },
};

const BONDS: FakeBlock = {
  nrows: () => 2,
  copyColStr: () => {
    throw new Error("no string column");
  },
};

/** A host whose announced status lines the test can read back. */
interface LoadedHost {
  app: Molvis;
  /** Every `status-message` the panel emitted, in order. */
  announced: string[];
}

/** A loaded, typed, clean scene with nothing optimized yet. */
function loadedHost(): LoadedHost {
  const announced: string[] = [];
  const fake: FakeMolvis = {
    system: {
      frame: {
        getBlock: (name) =>
          name === "atoms" ? ATOMS : name === "bonds" ? BONDS : undefined,
      },
    },
    world: {
      sceneIndex: { hasUnsavedChanges: false },
      selectionManager: {
        getState: () => ({
          atoms: new Set<number>(),
          bonds: new Set<number>(),
          revision: 0,
        }),
        on: () => undefined,
        off: () => undefined,
      },
    },
    events: {
      on: () => () => undefined,
      emit: (event, payload) => {
        if (event !== "status-message") return;
        announced.push((payload as { text: string }).text);
      },
    },
  };
  return { app: fake as unknown as Molvis, announced };
}

function loadedApp(): Molvis {
  return loadedHost().app;
}

/**
 * The panel warms the shared compute worker on mount. A unit test must not
 * spawn one (nor load its WASM), so the host gets a worker that never speaks:
 * `warmComputeWorker()` stays pending and the panel renders its idle form.
 */
class SilentWorker {
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null = null;
  postMessage(): void {}
  terminate(): void {}
  addEventListener(): void {}
  removeEventListener(): void {}
}

const realWorker = globalThis.Worker;

beforeEach(() => {
  globalThis.Worker = SilentWorker as unknown as typeof Worker;
});

afterEach(() => {
  globalThis.Worker = realWorker;
  runStub.impl = null;
});

/**
 * Stage's `runOptimize` snapshots the scene and drives a worker; a panel unit
 * test drives neither. `rstest.doMock` is deliberately the non-hoisted form so
 * the real module is fully loaded first and only `runOptimize` is swapped:
 * `UnsavedSceneError` stays the real class, which is what the panel's
 * `instanceof` branch is matched against. The stubbed panel module is built
 * once; each test installs its own `runStub.impl`.
 *
 * The panel is imported **only** through this door — a static import would
 * cache the module against the real `runOptimize` and the stub would never be
 * reached.
 */
type StageModule = typeof import("@molcrafts/molvis-stage");
type PanelModule =
  typeof import("../../../src/ui/layout/StructureOptimizePanel");
type StructureOptimizePanel = PanelModule["StructureOptimizePanel"];
type RunOptimizeStub = (
  app: Molvis,
  options: OptimizeOptions,
) => Promise<OptimizeOutcome>;

const runStub: { impl: RunOptimizeStub | null } = { impl: null };
let stubbedPanel: Promise<StructureOptimizePanel> | null = null;

function panelWithStubbedRun(): Promise<StructureOptimizePanel> {
  if (!stubbedPanel) {
    stubbedPanel = (async () => {
      const actual = await rstest.importActual<StageModule>(
        "@molcrafts/molvis-stage",
      );
      rstest.doMock("@molcrafts/molvis-stage", () => ({
        ...actual,
        runOptimize: (app: Molvis, options: OptimizeOptions) => {
          const impl = runStub.impl;
          if (!impl) throw new Error("no runOptimize stub installed");
          return impl(app, options);
        },
      }));
      const stubbed = await import(
        "../../../src/ui/layout/StructureOptimizePanel"
      );
      return stubbed.StructureOptimizePanel;
    })();
  }
  return stubbedPanel;
}

/** One finished run: 37 steps, converged, no capped hydrogens. */
const STAGED_OUTCOME: OptimizeOutcome = {
  steps: 37,
  energy: -12.482,
  maxForce: 0.041,
  converged: true,
  cancelled: false,
  atomCount: 3,
  fixedCount: 0,
  hydrogensAdded: 0,
  potential: "uff",
  optimizer: "lbfgs",
};

/** What the run in flight handed the panel, or a named failure. */
interface RunCapture {
  options: OptimizeOptions | null;
  finish: ((outcome: OptimizeOutcome) => void) | null;
}

function optionsOf(capture: RunCapture): OptimizeOptions {
  if (!capture.options) throw new Error("panel never called runOptimize");
  return capture.options;
}

function runControl(host: ParentNode): HTMLButtonElement {
  const control = host.querySelector<HTMLButtonElement>(
    '[aria-label="Run optimization"]',
  );
  if (!control) throw new Error("panel rendered no Run control");
  return control;
}

/** Percent the run bar is showing, straight off its progressbar role. */
function progressValue(host: ParentNode): string | null {
  const bar = host.querySelector('[role="progressbar"]');
  return bar?.getAttribute("aria-valuenow") ?? null;
}

/** Exact-text element lookup — the panel copy, not a substring match. */
function queryByText(root: ParentNode, text: string): Element | null {
  const hit = Array.from(root.querySelectorAll("*")).find(
    (element) => (element.textContent ?? "").trim() === text,
  );
  return hit ?? null;
}

/**
 * Everything the panel said about this run: rendered copy plus the status
 * lines it announced (the shell renders those in the status bar).
 */
function panelCopy(host: ParentNode, announced: readonly string[]): string {
  return [host.textContent ?? "", ...announced].join("\n");
}

/** Pick "Soft springs" in the Potential menu (Radix select, keyboard-opened). */
async function chooseSoftSprings(host: ParentNode): Promise<void> {
  const trigger = host.querySelector<HTMLElement>('[aria-label="Potential"]');
  if (!trigger) throw new Error("panel rendered no Potential control");
  await act(async () => {
    trigger.focus();
    trigger.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    );
  });
  const option = Array.from(
    document.body.querySelectorAll<HTMLElement>('[role="option"]'),
  ).find((element) => (element.textContent ?? "").trim() === "Soft springs");
  if (!option) throw new Error("Potential menu offered no Soft springs");
  await act(async () => {
    option.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, button: 0 }),
    );
    option.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
    option.click();
  });
}

/**
 * Drive the minimizer step beats both kernels report through `onProgress`
 * (molrs kernels send them as step beats, the soft/damped path mirrors its
 * status beats into the same callback) and read the bar after each one.
 */
async function beatReadings(
  host: ParentNode,
  options: OptimizeOptions,
): Promise<Array<string | null>> {
  const beat = options.onProgress;
  if (!beat) throw new Error("panel passed no onProgress to runOptimize");
  const readings: Array<string | null> = [progressValue(host)];
  await act(async () => {
    beat({
      step: 50,
      maxSteps: 100,
      energy: Number.NaN,
      maxForce: Number.NaN,
      converged: false,
    });
  });
  readings.push(progressValue(host));
  await act(async () => {
    beat({
      step: 100,
      maxSteps: 100,
      energy: -12.482,
      maxForce: 0.041,
      converged: true,
    });
  });
  readings.push(progressValue(host));
  return readings;
}

describe("StructureOptimizePanel", () => {
  it("shows a title-only empty state before the first run", async () => {
    const Panel = await panelWithStubbedRun();
    const { host, cleanup } = await mountComponent(<Panel app={loadedApp()} />);
    try {
      const empty = readEmptyState(host);
      expect(empty?.title ?? "(panel rendered no empty state)").toMatch(
        /^No .+ yet$/,
      );
      expect(empty?.descriptions ?? null).toEqual([]);
    } finally {
      await cleanup();
    }
  });

  it("asks for the user's own canvas edits when the run is gated", async () => {
    // Post-staging, "unsaved" also means "an optimize result is waiting", so
    // the pre-run gate has to name whose edits it is asking about.
    const Panel = await panelWithStubbedRun();
    runStub.impl = async () => {
      throw new UnsavedSceneError();
    };
    const { app, announced } = loadedHost();
    const { host, cleanup } = await mountComponent(<Panel app={app} />);
    try {
      await act(async () => {
        runControl(host).click();
      });
      const copy = panelCopy(document.body, announced);
      expect(copy).toContain(OPTIMIZE_DIRTY_GATE_HINT);
      expect(copy).not.toContain("Save scene before optimizing");
      expect(queryByText(document.body, "Save scene before optimizing")).toBe(
        null,
      );
    } finally {
      await cleanup();
    }
  });

  it("tells the user a finished run is staged until they save", async () => {
    const Panel = await panelWithStubbedRun();
    runStub.impl = async () => STAGED_OUTCOME;
    const { app, announced } = loadedHost();
    const { host, cleanup } = await mountComponent(<Panel app={app} />);
    try {
      await act(async () => {
        runControl(host).click();
      });
      // `document.body` holds the mounted host, so this reads panel copy
      // wherever it lands — inline result line or portal.
      expect(panelCopy(document.body, announced)).toContain(
        optimizeStagedLine(STAGED_OUTCOME),
      );
    } finally {
      await cleanup();
    }
  });

  it("advances the run bar from uff step beats", async () => {
    const Panel = await panelWithStubbedRun();
    const capture: RunCapture = { options: null, finish: null };
    runStub.impl = (_app, options) =>
      new Promise<OptimizeOutcome>((resolve) => {
        capture.options = options;
        capture.finish = resolve;
      });
    const { app } = loadedHost();
    const { host, cleanup } = await mountComponent(<Panel app={app} />);
    try {
      await act(async () => {
        runControl(host).click();
      });
      const options = optionsOf(capture);
      expect(options.potential).toBe("uff");
      const readings = await beatReadings(host, options);
      expect(readings.slice(0, 2)).toEqual(["0", "50"]);
      // Running caps at 98 (`Math.min(98, …)`); 100 is the completed state.
      expect(Number(readings[2])).toBeGreaterThanOrEqual(98);
      expect(Number(readings[2])).toBeLessThan(100);
      await act(async () => {
        capture.finish?.(STAGED_OUTCOME);
      });
    } finally {
      await cleanup();
    }
  });

  it("advances the run bar from soft-spring step beats", async () => {
    const Panel = await panelWithStubbedRun();
    const capture: RunCapture = { options: null, finish: null };
    runStub.impl = (_app, options) =>
      new Promise<OptimizeOutcome>((resolve) => {
        capture.options = options;
        capture.finish = resolve;
      });
    const { app } = loadedHost();
    const { host, cleanup } = await mountComponent(<Panel app={app} />);
    try {
      await chooseSoftSprings(host);
      await act(async () => {
        runControl(host).click();
      });
      const options = optionsOf(capture);
      expect(options.potential).toBe("soft");
      const readings = await beatReadings(host, options);
      expect(readings.slice(0, 2)).toEqual(["0", "50"]);
      expect(Number(readings[2])).toBeGreaterThanOrEqual(98);
      expect(Number(readings[2])).toBeLessThan(100);
      await act(async () => {
        capture.finish?.({
          ...STAGED_OUTCOME,
          potential: "soft",
          optimizer: "damped",
        });
      });
    } finally {
      await cleanup();
    }
  });
});
