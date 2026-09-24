/**
 * Surface continuity for the page shell.
 *
 * `App` used to return early into a separate tree when every chrome flag was
 * off. Because React reconciles by ancestor path, flipping the surface moved
 * the canvas between two trees — unmounting it, and with it the Babylon engine
 * and its WebGL context. The whole point of a live surface is that promoting a
 * view costs nothing, so the test that matters here asserts the canvas DOM node
 * is the *same instance* before and after a flip.
 *
 * CONSTRAINT — do not relax: this file asserts DOM presence and node identity
 * only. `App` statically imports `@/plugins`, whose barrel exports module-level
 * singleton stores (`analysisStore`, `dialogStore`, `panelStore`,
 * `toolbarActionStore`), and `bottom_panel_host.ts` holds a module-global
 * `lastRequest`. Asserting on any of those would make this suite
 * order-dependent.
 *
 * No Babylon: the `canvas` seam replaces the viewer, so `app` stays null and
 * the engine and the plugin bind never engage. No network: with
 * no `wsUrl`, `useBackendConnection` short-circuits to idle.
 */

import { describe, expect, it } from "@rstest/core";
import { act } from "react";
import App from "../src/App";
import { PipelineOperationProvider } from "../src/components/viewer/PipelineOperationProvider";
import { MountOptsRoot } from "../src/lib/MountOptsRoot";
import type { MountOpts } from "../src/lib/mount-opts";
import { MountOptsStore } from "../src/lib/mount-opts-store";
import { mountComponent } from "./react_harness";

const CANVAS_PROBE = "canvas-probe";

async function mountApp(seed: MountOpts) {
  const store = new MountOptsStore(seed);
  const mounted = await mountComponent(
    <MountOptsRoot store={store}>
      <PipelineOperationProvider>
        <App
          canvas={<div data-testid={CANVAS_PROBE} style={{ height: "100%" }} />}
        />
      </PipelineOperationProvider>
    </MountOptsRoot>,
  );
  return { store, mounted };
}

const probe = (host: HTMLElement) =>
  host.querySelector<HTMLElement>(`[data-testid="${CANVAS_PROBE}"]`);
// `ViewerToolbar`'s root is a plain div; `h-toolbar` is its one distinctive
// class and the only stable handle without adding markup for the test.
const toolbar = (host: HTMLElement) => host.querySelector(".h-toolbar");

describe("App", () => {
  it("keeps the canvas node mounted across a surface flip", async () => {
    const { store, mounted } = await mountApp({ surface: "canvas" });
    try {
      const before = probe(mounted.host);
      expect(before).not.toBeNull();
      expect(toolbar(mounted.host)).toBeNull();

      await act(async () => {
        store.patch({ surface: "full" });
      });

      // Identity, not presence: a remount creates a new node, so `===` is the
      // only assertion that catches the early return coming back.
      expect(probe(mounted.host)).toBe(before);
      expect(before?.isConnected).toBe(true);
      expect(toolbar(mounted.host)).not.toBeNull();
    } finally {
      await mounted.cleanup();
    }
  });

  it("renders no chrome region under the canvas surface", async () => {
    const { mounted } = await mountApp({ surface: "canvas" });
    try {
      const host = mounted.host;
      expect(toolbar(host)).toBeNull();
      expect(host.textContent).not.toContain("Open in browser");
      // The surface is host-owned (the VS Code tab toggle, `setOpts`): the
      // shell must not keep its own "Show controls" affordance.
      expect(host.querySelector('[aria-label="Show controls"]')).toBeNull();
      // The shortcuts dialog is not merely closed — it is not rendered.
      await act(async () => {
        document.dispatchEvent(
          new KeyboardEvent("keydown", { key: "?", bubbles: true }),
        );
      });
      expect(document.body.textContent).not.toContain("Keyboard shortcuts");
    } finally {
      await mounted.cleanup();
    }
  });
});
