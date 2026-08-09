import { describe, expect, it } from "@rstest/core";
import React from "react";
import { createRoot } from "react-dom/client";
import { ViewerSidePanel } from "../../../src/components/viewer/ViewerSidePanel";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const nextFrame = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

describe("ViewerSidePanel", () => {
  it("preserves child state while changing between inline and drawer states", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const panelRef = React.createRef<HTMLElement>();

    const StatefulChild = () => {
      const [count, setCount] = React.useState(0);
      return (
        <button type="button" onClick={() => setCount((value) => value + 1)}>
          Count {count}
        </button>
      );
    };

    const renderPanel = async (drawer: boolean, open: boolean) => {
      await React.act(async () => {
        root.render(
          <ViewerSidePanel
            drawer={drawer}
            inlineWidth="15%"
            label="Test panel"
            onClose={() => undefined}
            open={open}
            panelRef={panelRef}
            side="left"
          >
            <StatefulChild />
          </ViewerSidePanel>,
        );
      });
    };

    await renderPanel(false, true);
    const counter = host.querySelector<HTMLButtonElement>("button:last-child");
    expect(counter).not.toBeNull();

    await React.act(async () => counter?.click());
    expect(counter?.textContent).toBe("Count 1");

    await renderPanel(true, false);
    await renderPanel(true, true);
    await React.act(nextFrame);

    expect(host.querySelector("button:last-child")).toBe(counter);
    expect(counter?.textContent).toBe("Count 1");

    await React.act(async () => root.unmount());
    host.remove();
  });

  it("suspends child effects while preserving state and identity when hidden", async () => {
    type Listener = () => void;

    class TestEventSource {
      private readonly listeners = new Set<Listener>();

      emit(): void {
        for (const listener of this.listeners) listener();
      }

      listenerCount(): number {
        return this.listeners.size;
      }

      subscribe(listener: Listener): () => void {
        this.listeners.add(listener);
        return () => {
          this.listeners.delete(listener);
        };
      }
    }

    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const panelRef = React.createRef<HTMLElement>();
    const events = new TestEventSource();
    const metrics = {
      cleanups: 0,
      setups: 0,
      updateCommits: 0,
      work: 0,
    };

    const EffectChild = () => {
      const [revision, setRevision] = React.useState(0);

      React.useEffect(() => {
        metrics.setups += 1;
        const unsubscribe = events.subscribe(() => {
          metrics.work += 1;
          setRevision((value) => value + 1);
        });
        return () => {
          metrics.cleanups += 1;
          unsubscribe();
        };
      }, []);

      const onRender: React.ProfilerOnRenderCallback = (_id, phase) => {
        if (phase !== "mount") metrics.updateCommits += 1;
      };

      return (
        <React.Profiler id="side-panel-effect" onRender={onRender}>
          <output data-testid="effect-child">Revision {revision}</output>
        </React.Profiler>
      );
    };

    const renderPanel = async (drawer: boolean, open: boolean) => {
      await React.act(async () => {
        root.render(
          <ViewerSidePanel
            drawer={drawer}
            inlineWidth="15%"
            label="Test panel"
            onClose={() => undefined}
            open={open}
            panelRef={panelRef}
            side="left"
          >
            <EffectChild />
          </ViewerSidePanel>,
        );
      });
    };

    try {
      await renderPanel(false, true);
      const child = host.querySelector<HTMLOutputElement>(
        '[data-testid="effect-child"]',
      );
      expect(child).not.toBeNull();

      await React.act(async () => events.emit());
      const open = {
        cleanups: metrics.cleanups,
        listeners: events.listenerCount(),
        setups: metrics.setups,
        state: child?.textContent,
        updateCommits: metrics.updateCommits,
        work: metrics.work,
      };

      await renderPanel(false, false);
      const closedChild = host.querySelector<HTMLOutputElement>(
        '[data-testid="effect-child"]',
      );
      const closed = {
        cleanups: metrics.cleanups,
        listeners: events.listenerCount(),
        sameNode: closedChild === child,
        setups: metrics.setups,
        state: closedChild?.textContent,
      };

      metrics.updateCommits = 0;
      metrics.work = 0;
      await React.act(async () => events.emit());
      const hiddenEvent = {
        state: closedChild?.textContent,
        updateCommits: metrics.updateCommits,
        work: metrics.work,
      };

      await renderPanel(false, true);
      const reopenedChild = host.querySelector<HTMLOutputElement>(
        '[data-testid="effect-child"]',
      );
      const reopened = {
        cleanups: metrics.cleanups,
        listeners: events.listenerCount(),
        sameNode: reopenedChild === child,
        setups: metrics.setups,
        state: reopenedChild?.textContent,
      };

      metrics.updateCommits = 0;
      metrics.work = 0;
      await React.act(async () => events.emit());
      const reopenedEvent = {
        state: reopenedChild?.textContent,
        updateCommits: metrics.updateCommits,
        work: metrics.work,
      };

      await renderPanel(true, true);
      const drawerChild = host.querySelector<HTMLOutputElement>(
        '[data-testid="effect-child"]',
      );
      const drawerToggle = {
        cleanups: metrics.cleanups,
        listeners: events.listenerCount(),
        sameNode: drawerChild === child,
        setups: metrics.setups,
        state: drawerChild?.textContent,
      };

      expect({
        closed,
        drawerToggle,
        hiddenEvent,
        open,
        reopened,
        reopenedEvent,
      }).toEqual({
        closed: {
          cleanups: 1,
          listeners: 0,
          sameNode: true,
          setups: 1,
          state: "Revision 1",
        },
        drawerToggle: {
          cleanups: 1,
          listeners: 1,
          sameNode: true,
          setups: 2,
          state: "Revision 2",
        },
        hiddenEvent: {
          state: "Revision 1",
          updateCommits: 0,
          work: 0,
        },
        open: {
          cleanups: 0,
          listeners: 1,
          setups: 1,
          state: "Revision 1",
          updateCommits: 1,
          work: 1,
        },
        reopened: {
          cleanups: 1,
          listeners: 1,
          sameNode: true,
          setups: 2,
          state: "Revision 1",
        },
        reopenedEvent: {
          state: "Revision 2",
          updateCommits: 1,
          work: 1,
        },
      });
    } finally {
      await React.act(async () => root.unmount());
      host.remove();
    }
  });

  it("takes drawer focus from the opener and gives it back on close", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const panelRef = React.createRef<HTMLElement>();

    const Harness = ({ open }: { open: boolean }) => (
      <>
        <button type="button">Open</button>
        <ViewerSidePanel
          drawer
          inlineWidth="15%"
          label="Test drawer"
          onClose={() => undefined}
          open={open}
          panelRef={panelRef}
          side="right"
        >
          {/* No close affordance — the drawer closes by rail, scrim, or Escape. */}
          <button type="button">Only action</button>
        </ViewerSidePanel>
      </>
    );

    await React.act(async () => root.render(<Harness open={false} />));
    const opener = host.querySelector<HTMLButtonElement>("button");
    expect(opener).not.toBeNull();
    opener?.focus();

    await React.act(async () => root.render(<Harness open />));
    await React.act(nextFrame);
    expect(document.activeElement).toBe(panelRef.current);

    await React.act(async () => root.render(<Harness open={false} />));
    expect(document.activeElement).toBe(opener);

    await React.act(async () => root.unmount());
    host.remove();
  });
});
