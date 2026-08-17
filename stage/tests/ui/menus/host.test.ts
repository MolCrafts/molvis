import { afterEach, beforeEach, describe, expect, it } from "@rstest/core";
import type { MolvisApp } from "../../../src/app";
import { registerWebComponents } from "../../../src/dom_helpers";
import type { MenuItem, SceneHit } from "../../../src/mode/types";
import { ContextMenuHost } from "../../../src/ui/menus/host";

type StubApp = Pick<
  MolvisApp,
  "uiContainer" | "config" | "resolveContextMenuItems"
>;

function createStubApp(overrides?: {
  showContextMenu?: boolean;
  buildItems?: (ctx: {
    menuId: string;
    hit: SceneHit | null;
    items: readonly MenuItem[];
  }) => MenuItem[];
}): StubApp {
  const uiContainer = document.createElement("div");
  document.body.appendChild(uiContainer);

  const showContextMenu = overrides?.showContextMenu ?? true;
  const buildItems = overrides?.buildItems;

  return {
    uiContainer,
    config: {
      ui: { showContextMenu },
    } as MolvisApp["config"],
    resolveContextMenuItems(context) {
      if (!buildItems) {
        return [...context.items];
      }
      return buildItems({
        menuId: context.menuId,
        hit: context.hit,
        items: context.items,
      });
    },
  };
}

function asApp(stub: StubApp): MolvisApp {
  return stub as unknown as MolvisApp;
}

function menuEl(menuId: string): HTMLElement | null {
  return document.getElementById(menuId);
}

/** Wait for Host's setTimeout(0) document-listener registration. */
function flushOpen(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("ContextMenuHost", () => {
  let stubs: StubApp[] = [];

  beforeEach(() => {
    registerWebComponents();
    stubs = [];
  });

  afterEach(() => {
    for (const s of stubs) {
      s.uiContainer.remove();
    }
    stubs = [];
    for (const id of [
      "test-menu-a",
      "test-menu-b",
      "test-menu-ignore",
      "test-menu-gate",
      "test-menu-esc",
      "test-menu-btn",
    ]) {
      document.getElementById(id)?.remove();
    }
  });

  function track(stub: StubApp): StubApp {
    stubs.push(stub);
    return stub;
  }

  it("shows a menu and registers the element under uiContainer", async () => {
    const app = track(createStubApp());
    const host = new ContextMenuHost(asApp(app), "test-menu-a");
    const shown = host.show(10, 20, [
      { type: "button", title: "Hello", action: () => {} },
    ]);
    expect(shown).toBe(true);
    expect(host.isVisible).toBe(true);
    const el = menuEl("test-menu-a");
    expect(el).not.toBeNull();
    expect(app.uiContainer.contains(el)).toBe(true);
    expect(el!.style.display).toBe("block");
    host.dispose();
  });

  it("enforces registry mutual exclusion between two hosts", async () => {
    const app = track(createStubApp());
    const a = new ContextMenuHost(asApp(app), "test-menu-a");
    const b = new ContextMenuHost(asApp(app), "test-menu-b");
    const item = (title: string): MenuItem => ({
      type: "button",
      title,
      action: () => {},
    });

    expect(a.show(0, 0, [item("A")])).toBe(true);
    expect(a.isVisible).toBe(true);

    expect(b.show(0, 0, [item("B")])).toBe(true);
    expect(b.isVisible).toBe(true);
    expect(a.isVisible).toBe(false);
    expect(menuEl("test-menu-a")!.style.display).toBe("none");
    expect(menuEl("test-menu-b")!.style.display).toBe("block");

    a.dispose();
    b.dispose();
  });

  it("dismisses on outside click after open", async () => {
    const app = track(createStubApp());
    const host = new ContextMenuHost(asApp(app), "test-menu-a");
    host.show(5, 5, [{ type: "button", title: "X", action: () => {} }]);
    await flushOpen();

    document.body.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );
    expect(host.isVisible).toBe(false);
    host.dispose();
  });

  it("does not dismiss when click is on ignoreCloseTargets", async () => {
    const app = track(createStubApp());
    const panel = document.createElement("div");
    document.body.appendChild(panel);
    const host = new ContextMenuHost(asApp(app), "test-menu-ignore", {
      ignoreCloseTargets: () => [panel],
    });
    host.show(5, 5, [{ type: "button", title: "X", action: () => {} }]);
    await flushOpen();

    panel.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );
    expect(host.isVisible).toBe(true);

    host.dispose();
    panel.remove();
  });

  it("hides on Escape", async () => {
    const app = track(createStubApp());
    const host = new ContextMenuHost(asApp(app), "test-menu-esc");
    host.show(5, 5, [{ type: "button", title: "X", action: () => {} }]);
    await flushOpen();

    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(host.isVisible).toBe(false);
    host.dispose();
  });

  it("hides after button action", async () => {
    const app = track(createStubApp());
    const host = new ContextMenuHost(asApp(app), "test-menu-btn");
    let clicked = 0;
    host.show(5, 5, [
      {
        type: "button",
        title: "Go",
        action: () => {
          clicked += 1;
        },
      },
    ]);
    await flushOpen();

    // Menu items live in molvis-context-menu's shadow root.
    const buttonHost =
      menuEl("test-menu-btn")?.shadowRoot?.querySelector("molvis-button");
    expect(buttonHost).not.toBeNull();
    // Click the button host's shadow .button row (stops propagation on it).
    const row = buttonHost!.shadowRoot?.querySelector(".button") as HTMLElement;
    expect(row).not.toBeNull();
    row.click();

    expect(clicked).toBe(1);
    expect(host.isVisible).toBe(false);
    host.dispose();
  });

  it("no-ops when showContextMenu is false", () => {
    const app = track(createStubApp({ showContextMenu: false }));
    const host = new ContextMenuHost(asApp(app), "test-menu-gate");
    const shown = host.show(1, 1, [
      { type: "button", title: "Nope", action: () => {} },
    ]);
    expect(shown).toBe(false);
    expect(host.isVisible).toBe(false);
    expect(menuEl("test-menu-gate")).toBeNull();
    host.dispose();
  });

  it("forwards menuId and hit into resolveContextMenuItems", () => {
    let seenMenuId = "";
    let seenHit: SceneHit | null = null;
    const app = track(
      createStubApp({
        buildItems: ({ menuId, hit, items }) => {
          seenMenuId = menuId;
          seenHit = hit;
          return [...items];
        },
      }),
    );
    const host = new ContextMenuHost(asApp(app), "test-menu-a");
    const hit: SceneHit = { type: "empty" };
    host.show(0, 0, [{ type: "button", title: "Y", action: () => {} }], {
      hit,
    });
    expect(seenMenuId).toBe("test-menu-a");
    expect(seenHit).toBe(hit);
    host.dispose();
  });

  it("renders checked mark and does not fire disabled actions", async () => {
    const app = track(createStubApp());
    const host = new ContextMenuHost(asApp(app), "test-menu-btn");
    let disabledClicks = 0;
    let enabledClicks = 0;
    host.show(5, 5, [
      {
        type: "button",
        title: "On",
        checked: true,
        action: () => {
          enabledClicks += 1;
        },
      },
      {
        type: "button",
        title: "No",
        disabled: true,
        action: () => {
          disabledClicks += 1;
        },
      },
    ]);
    await flushOpen();

    const buttons =
      menuEl("test-menu-btn")?.shadowRoot?.querySelectorAll("molvis-button");
    expect(buttons?.length).toBe(2);
    const check = buttons![0].shadowRoot?.querySelector(".check");
    expect(check?.textContent).toBe("✓");

    const disabledRow = buttons![1].shadowRoot?.querySelector(
      ".button",
    ) as HTMLElement;
    disabledRow.click();
    expect(disabledClicks).toBe(0);
    expect(host.isVisible).toBe(true);

    const enabledRow = buttons![0].shadowRoot?.querySelector(
      ".button",
    ) as HTMLElement;
    enabledRow.click();
    expect(enabledClicks).toBe(1);
    expect(host.isVisible).toBe(false);
    host.dispose();
  });
});
