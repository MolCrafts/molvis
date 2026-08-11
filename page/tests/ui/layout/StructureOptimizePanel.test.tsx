import type { Molvis } from "@molcrafts/molvis-stage";
import { afterEach, beforeEach, describe, expect, it } from "@rstest/core";
import { StructureOptimizePanel } from "../../../src/ui/layout/StructureOptimizePanel";
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

/** A loaded, typed, clean scene with nothing optimized yet. */
function loadedApp(): Molvis {
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
      emit: () => undefined,
    },
  };
  return fake as unknown as Molvis;
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
});

describe("StructureOptimizePanel", () => {
  it("shows a title-only empty state before the first run", async () => {
    const { host, cleanup } = await mountComponent(
      <StructureOptimizePanel app={loadedApp()} />,
    );
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
});
