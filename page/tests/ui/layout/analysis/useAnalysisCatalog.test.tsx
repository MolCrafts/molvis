import type { Molvis } from "@molcrafts/molvis-stage";
import { describe, expect, it } from "@rstest/core";
import * as React from "react";
import { createRoot } from "react-dom/client";
import {
  type AnalysisCatalogState,
  useAnalysisCatalog,
} from "../../../../src/ui/layout/analysis/useAnalysisCatalog";
import { enableReactActEnvironment } from "../../../react_harness";

enableReactActEnvironment();

type Listener = () => void;

class FakeEvents {
  private readonly listeners = new Map<string, Set<Listener>>();

  on(event: string, listener: Listener): () => void {
    const eventListeners = this.listeners.get(event) ?? new Set<Listener>();
    eventListeners.add(listener);
    this.listeners.set(event, eventListeners);
    return () => {
      eventListeners.delete(listener);
    };
  }

  emit(event: string): void {
    for (const listener of this.listeners.get(event) ?? []) {
      listener();
    }
  }
}

interface FakeMolvis {
  readonly system: { readonly frame: null };
  readonly events: { on: (event: string, listener: Listener) => () => void };
  readonly modifierPipeline: {
    on: (event: string, listener: Listener) => () => void;
  };
}

function fakeMolvis(): { app: Molvis; events: FakeEvents } {
  const events = new FakeEvents();
  const pipelineEvents = new FakeEvents();
  const fake: FakeMolvis = {
    system: { frame: null },
    events: { on: (event, listener) => events.on(event, listener) },
    modifierPipeline: {
      on: (event, listener) => pipelineEvents.on(event, listener),
    },
  };
  return { app: fake as unknown as Molvis, events };
}

interface ProbeLog {
  probing: boolean[];
  latest: AnalysisCatalogState | null;
}

function CatalogProbe({
  app,
  hasSelection,
  log,
}: {
  app: Molvis;
  hasSelection: boolean;
  log: ProbeLog;
}) {
  const catalog = useAnalysisCatalog(app, hasSelection);
  log.probing.push(catalog.probing);
  log.latest = catalog;
  return null;
}

/** Matches the hook's `setTimeout(0)` then `Promise.resolve()` probe yield. */
async function flushProbe(): Promise<void> {
  await React.act(async () => {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
    await Promise.resolve();
  });
}

interface MountedCatalog {
  events: FakeEvents;
  log: ProbeLog;
  render: (open: boolean, hasSelection: boolean) => Promise<void>;
  cleanup: () => Promise<void>;
}

async function mountCatalog(
  open = true,
  hasSelection = false,
): Promise<MountedCatalog> {
  const { app, events } = fakeMolvis();
  const log: ProbeLog = { probing: [], latest: null };
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);

  const render = async (nextOpen: boolean, nextHasSelection: boolean) => {
    await React.act(async () => {
      root.render(
        <React.Activity mode={nextOpen ? "visible" : "hidden"}>
          <CatalogProbe app={app} hasSelection={nextHasSelection} log={log} />
        </React.Activity>,
      );
    });
  };

  await render(open, hasSelection);

  return {
    events,
    log,
    render,
    cleanup: async () => {
      await React.act(async () => {
        root.unmount();
      });
      host.remove();
    },
  };
}

describe("useAnalysisCatalog", () => {
  it("probes on first mount and settles with groups", async () => {
    const { log, cleanup } = await mountCatalog();
    try {
      await flushProbe();

      expect(log.probing).toContain(true);
      expect(log.probing.at(-1)).toBe(false);
      expect(log.latest?.probing).toBe(false);
      expect(log.latest?.probeKey).toBe("empty|sel=0");
      expect(log.latest?.groups.length ?? 0).toBeGreaterThan(0);
    } finally {
      await cleanup();
    }
  });

  it("does not probe when Activity remounts with the same structure key", async () => {
    const { log, render, cleanup } = await mountCatalog();
    try {
      await flushProbe();
      expect(log.latest?.probing).toBe(false);

      log.probing.length = 0;
      await render(false, false);
      await render(true, false);
      await flushProbe();

      expect(log.probing).not.toContain(true);
      expect(log.latest?.probing).toBe(false);
    } finally {
      await cleanup();
    }
  });

  it("does not probe on frame-change with the same structure key", async () => {
    const { events, log, cleanup } = await mountCatalog();
    try {
      await flushProbe();
      expect(log.latest?.probing).toBe(false);

      log.probing.length = 0;
      await React.act(async () => {
        events.emit("frame-change");
      });
      await flushProbe();

      expect(log.probing).not.toContain(true);
      expect(log.latest?.probing).toBe(false);
    } finally {
      await cleanup();
    }
  });

  it("probes when the structure key changes", async () => {
    const { log, render, cleanup } = await mountCatalog();
    try {
      await flushProbe();
      expect(log.latest?.probeKey).toBe("empty|sel=0");

      log.probing.length = 0;
      await render(true, true);
      await flushProbe();

      expect(log.probing).toContain(true);
      expect(log.probing.at(-1)).toBe(false);
      expect(log.latest?.probing).toBe(false);
      expect(log.latest?.probeKey).toBe("empty|sel=1");
    } finally {
      await cleanup();
    }
  });
});
