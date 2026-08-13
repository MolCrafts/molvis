import { describe, expect, it } from "@rstest/core";
import React from "react";
import { createRoot } from "react-dom/client";
import { Tabs } from "../../../src/components/ui/tabs";
import { PanelTabStrip } from "../../../src/components/viewer/PanelTabStrip";
import { enableReactActEnvironment } from "../../react_harness";

enableReactActEnvironment();

const ITEMS = [
  { value: "compute", label: "Compute", icon: <svg aria-hidden /> },
  { value: "optimize", label: "Optimization", icon: <svg aria-hidden /> },
];

describe("PanelTabStrip", () => {
  it("names every tab without rendering its wording", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);

    await React.act(async () => {
      root.render(
        <Tabs value="compute" onValueChange={() => undefined}>
          <PanelTabStrip items={ITEMS} label="Advanced tool" />
        </Tabs>,
      );
    });

    const strip = host.querySelector<HTMLElement>('[role="tablist"]');
    const tabs = Array.from(
      host.querySelectorAll<HTMLElement>('[role="tab"]'),
    ).map((tab) => ({
      name: tab.getAttribute("aria-label"),
      selected: tab.getAttribute("aria-selected"),
      // TooltipTrigger's asChild overwrites the tab's own data-state, so the
      // active styling must key off aria-selected. If this ever reads
      // "active", data-[state=active]: styling is viable again.
      dataState: tab.getAttribute("data-state"),
    }));

    expect({
      stripName: strip?.getAttribute("aria-label"),
      // Glyph-only chrome: the wording lives in tooltips and accessible names.
      stripText: strip?.textContent,
      tabs,
    }).toEqual({
      stripName: "Advanced tool",
      stripText: "",
      tabs: [
        { name: "Compute", selected: "true", dataState: "closed" },
        { name: "Optimization", selected: "false", dataState: "closed" },
      ],
    });

    await React.act(async () => root.unmount());
    host.remove();
  });

  it("reports the clicked tab and blocks selection while disabled", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const changes: string[] = [];

    const renderStrip = async (disabled: boolean) => {
      await React.act(async () => {
        root.render(
          <Tabs value="compute" onValueChange={(value) => changes.push(value)}>
            <PanelTabStrip
              items={ITEMS}
              label="Advanced tools"
              disabled={disabled}
            />
          </Tabs>,
        );
      });
    };

    // Radix selects a tab on mousedown, not on a synthetic click().
    const pressOptimize = async () => {
      const tab = host.querySelector<HTMLButtonElement>(
        '[role="tab"][aria-label="Optimization"]',
      );
      await React.act(async () => {
        tab?.dispatchEvent(
          new MouseEvent("mousedown", { bubbles: true, button: 0 }),
        );
      });
    };

    await renderStrip(false);
    await pressOptimize();

    await renderStrip(true);
    await pressOptimize();

    expect(changes).toEqual(["optimize"]);

    await React.act(async () => root.unmount());
    host.remove();
  });
});
