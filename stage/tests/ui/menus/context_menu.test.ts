import { afterEach, beforeAll, describe, expect, it } from "@rstest/core";
import { registerWebComponents } from "../../../src/dom_helpers";
import type { MenuItem } from "../../../src/mode/types";
import { MolvisContextMenu } from "../../../src/ui/menus/context_menu";

function menu(): MolvisContextMenu {
  const el = document.createElement("molvis-context-menu");
  if (!(el instanceof MolvisContextMenu)) {
    throw new TypeError("molvis-context-menu was not registered");
  }
  document.body.append(el);
  return el;
}

describe("MolvisContextMenu", () => {
  beforeAll(() => {
    registerWebComponents();
  });

  afterEach(() => {
    for (const el of document.querySelectorAll("molvis-context-menu")) {
      el.remove();
    }
  });

  it("paints rows in one shadow tree with a reserved check column", () => {
    const el = menu();
    const items: MenuItem[] = [
      { type: "label", title: "C 12" },
      { type: "separator" },
      { type: "button", title: "Select", action: () => {} },
      { type: "button", title: "Grid", checked: true, action: () => {} },
    ];
    el.show(8, 8, items);

    const root = el.shadowRoot;
    expect(root?.querySelector("molvis-button")).toBeNull();
    expect(root?.querySelector("molvis-folder")).toBeNull();
    const rows = root?.querySelectorAll(".row.is-action");
    expect(rows?.length).toBe(2);
    expect(rows![0].querySelector(".check")?.textContent).toBe("");
    expect(rows![1].querySelector(".check")?.textContent).toBe("✓");
    expect(getComputedStyle(rows![0]).display).toBe("grid");
    const labelLeft = [...root!.querySelectorAll(".label")].map(
      (node) => node.getBoundingClientRect().left,
    );
    expect(Math.max(...labelLeft) - Math.min(...labelLeft)).toBeLessThan(1);
  });

  it("shows folder current value in the meta column", () => {
    const el = menu();
    el.show(0, 0, [
      {
        type: "folder",
        title: "Distance",
        items: [
          { type: "button", title: "Å", checked: true, action: () => {} },
          { type: "button", title: "nm", checked: false, action: () => {} },
        ],
      },
    ]);
    const folder = el.shadowRoot?.querySelector(".row.is-folder");
    expect(folder?.querySelector(".label")?.textContent).toBe("Distance");
    expect(folder?.querySelector(".meta")?.textContent).toBe("Å");
    (folder as HTMLElement).click();
    const flyout = el.shadowRoot?.querySelector(".flyout");
    expect(flyout?.classList.contains("is-open")).toBe(true);
    expect(flyout?.querySelectorAll(".row.is-action")).toHaveLength(2);
  });

  it("paints an opaque plate with a short shadow", () => {
    const el = menu();
    el.show(8, 8, [{ type: "button", title: "Select", action: () => {} }]);
    const style = getComputedStyle(el);
    expect(alphaOf(style.backgroundColor)).toBe(1);
    expect(shadowBlurPx(style.boxShadow)).toBeLessThan(8);
  });
});

function alphaOf(color: string): number {
  const slash = color.match(/\/\s*([\d.]+)%?\s*\)/);
  if (slash?.[1]) {
    return slash[1].endsWith("%")
      ? Number(slash[1].slice(0, -1)) / 100
      : Number(slash[1]);
  }
  const rgba = color.match(
    /rgba\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*,\s*([\d.]+)\s*\)/,
  );
  if (rgba?.[1]) return Number(rgba[1]);
  return 1;
}

function shadowBlurPx(shadow: string): number {
  const lengths = [...shadow.matchAll(/(-?[\d.]+)px/g)].map((match) =>
    Math.abs(Number(match[1])),
  );
  return lengths[2] ?? 0;
}
