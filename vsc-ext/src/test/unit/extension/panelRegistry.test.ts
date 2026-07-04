import * as assert from "assert";
import { InMemoryPanelRegistry } from "../../../extension/panels/panelRegistry";
import type { PanelHandle } from "../../../extension/types";

/** A minimal `PanelHandle` mock that looks like a `WebviewView`. */
function makePanelHandle(opts: {
  webview?: Partial<PanelHandle["webview"]>;
  visible?: boolean;
  viewType?: string;
}): PanelHandle {
  return {
    webview: (opts.webview ?? { html: "" }) as PanelHandle["webview"],
    visible: opts.visible ?? true,
    ...(opts.viewType ? { viewType: opts.viewType } : {}),
  } as PanelHandle;
}

suite("panelRegistry", () => {
  test("forEachVisible only visits visible panels", async () => {
    const registry = new InMemoryPanelRegistry();

    const visiblePanel = makePanelHandle({ visible: true });
    const hiddenPanel = makePanelHandle({ visible: false });

    registry.register(visiblePanel, { getHtml: () => "visible" });
    registry.register(hiddenPanel, { getHtml: () => "hidden" });

    const htmlValues: string[] = [];
    await registry.forEachVisible((_panel, meta) => {
      htmlValues.push(meta.getHtml());
    });

    assert.deepStrictEqual(htmlValues, ["visible"]);
  });

  test("unregister removes panel from traversal", async () => {
    const registry = new InMemoryPanelRegistry();
    const panel = makePanelHandle({});

    registry.register(panel, { getHtml: () => "x" });
    registry.unregister(panel);

    let calls = 0;
    await registry.forEachVisible(() => {
      calls += 1;
    });

    assert.strictEqual(calls, 0);
  });

  test("getRegisteredViewTypes reads viewType from meta (WebviewView path)", () => {
    const registry = new InMemoryPanelRegistry();
    // Simulate a WebviewView which has no native viewType property.
    const panel = makePanelHandle({ visible: true });

    registry.register(panel, {
      getHtml: () => "",
      viewType: "molvis.pageView",
    });

    const types = registry.getRegisteredViewTypes();
    assert.ok(types.includes("molvis.pageView"));
  });

  test("getRegisteredViewTypes falls back to panel.viewType (WebviewPanel path)", () => {
    const registry = new InMemoryPanelRegistry();
    const panel = makePanelHandle({ viewType: "molvis.workspace" });

    registry.register(panel, { getHtml: () => "" });

    const types = registry.getRegisteredViewTypes();
    assert.ok(types.includes("molvis.workspace"));
  });

  test("forEach visits all panels regardless of visibility", async () => {
    const registry = new InMemoryPanelRegistry();
    const visible = makePanelHandle({ visible: true });
    const hidden = makePanelHandle({ visible: false });

    registry.register(visible, { getHtml: () => "v" });
    registry.register(hidden, { getHtml: () => "h" });

    const values: string[] = [];
    await registry.forEach((_panel, meta) => {
      values.push(meta.getHtml());
    });

    assert.deepStrictEqual(values.sort(), ["h", "v"]);
  });
});
