import type { Molvis } from "@molcrafts/molvis-stage";
import { describe, expect, it } from "@rstest/core";
import React from "react";
import { createRoot } from "react-dom/client";
import { BondMappingPickerProvider } from "../../../src/components/bond-column-mapping-dialog";
import { FormatPickerProvider } from "../../../src/components/format-picker-dialog";
import { PipelineOperationProvider } from "../../../src/components/viewer/PipelineOperationProvider";
import { StructureInspector } from "../../../src/components/viewer/StructureInspector";
import { enableReactActEnvironment } from "../../react_harness";

enableReactActEnvironment();
(globalThis as typeof globalThis & { React: typeof React }).React = React;

type Listener = (...args: unknown[]) => void;

class TestEventSource {
  private readonly listeners = new Map<string, Set<Listener>>();

  on(event: string, listener: Listener): () => void {
    const eventListeners = this.listeners.get(event) ?? new Set<Listener>();
    eventListeners.add(listener);
    this.listeners.set(event, eventListeners);
    return () => {
      eventListeners.delete(listener);
    };
  }

  off(event: string, listener: Listener): void {
    this.listeners.get(event)?.delete(listener);
  }

  emit(event: string): void {
    for (const listener of this.listeners.get(event) ?? []) {
      listener();
    }
  }

  listenerCount(event: string): number {
    return this.listeners.get(event)?.size ?? 0;
  }
}

describe("StructureInspector", () => {
  it("does no Select extraction or commits after switching to View", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const events = new TestEventSource();
    const pipelineEvents = new TestEventSource();
    const selectionEvents = new TestEventSource();
    const metrics = { extractionWork: 0, updateCommits: 0 };
    const frame = {
      getBlock: (_name: string) => {
        metrics.extractionWork += 1;
        return undefined;
      },
    };
    const app = {
      events,
      frame: null,
      modifierPipeline: {
        getEntries: () => [],
        modifiers: () => [],
        sources: () => [],
        off: (event: string, listener: Listener) =>
          pipelineEvents.off(event, listener),
        on: (event: string, listener: Listener) =>
          pipelineEvents.on(event, listener),
      },
      pendingAtomCount: 0,
      pendingBondCount: 0,
      selectionSet: new Map(),
      system: { frame },
      world: {
        sceneIndex: {
          getAttribute: () => undefined,
        },
        selectionManager: {
          apply: () => undefined,
          getSelectedAtomIds: () => new Set<number>(),
          getState: () => ({
            atoms: new Set<number>(),
            bonds: new Set<number>(),
            revision: 0,
          }),
          off: (event: string, listener: Listener) =>
            selectionEvents.off(event, listener),
          on: (event: string, listener: Listener) =>
            selectionEvents.on(event, listener),
        },
      },
    } as unknown as Molvis;

    const onRender: React.ProfilerOnRenderCallback = (_id, phase) => {
      if (phase !== "mount") metrics.updateCommits += 1;
    };
    const renderMode = async (currentMode: string) => {
      await React.act(async () => {
        root.render(
          <PipelineOperationProvider>
            <FormatPickerProvider>
              <BondMappingPickerProvider>
                <React.Profiler id="select-data-inspector" onRender={onRender}>
                  <StructureInspector
                    app={app}
                    currentMode={currentMode}
                    onModeChange={() => undefined}
                  />
                </React.Profiler>
              </BondMappingPickerProvider>
            </FormatPickerProvider>
          </PipelineOperationProvider>,
        );
      });
    };

    try {
      await renderMode("select");
      await renderMode("view");
      metrics.extractionWork = 0;
      metrics.updateCommits = 0;

      // View does not subscribe to frame-rendered, so a commit here can only
      // come from the retained, hidden Select data inspector.
      await React.act(async () => events.emit("frame-rendered"));
      const hiddenUpdateCommits = metrics.updateCommits;

      // View legitimately observes frame-change. Extraction work and the
      // additional listener still identify a retained hidden Select panel.
      await React.act(async () => events.emit("frame-change"));

      expect({
        extractionWork: metrics.extractionWork,
        frameChangeListeners: events.listenerCount("frame-change"),
        frameRenderedListeners: events.listenerCount("frame-rendered"),
        hiddenUpdateCommits,
      }).toEqual({
        extractionWork: 0,
        frameChangeListeners: 1,
        frameRenderedListeners: 0,
        hiddenUpdateCommits: 0,
      });
    } finally {
      await React.act(async () => root.unmount());
      host.remove();
    }
  });
});
