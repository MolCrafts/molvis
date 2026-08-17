import type { AnalysisDefinition } from "@molcrafts/molvis-stage";
import { describe, expect, it } from "@rstest/core";
import { act } from "react";
import {
  AnalysisPicker,
  type PickerGroup,
} from "../../../../src/ui/layout/analysis/AnalysisPicker";
import { mountComponent } from "../../../react_harness";

/**
 * The catalog picker is the product's front door for Compute. `.claude/notes/
 * compute-form-design.md` (rename table) puts every user-visible string on
 * **Compute**; "Analysis" survives only in internal module/component names,
 * which this test deliberately ignores (it reads copy, never identifiers or
 * `data-*` hook names).
 */

const nextFrame = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

function definition(id: string, label: string): AnalysisDefinition {
  return {
    id,
    category: "structure",
    label,
    wasmExport: "Rdf",
    inputKind: "frame",
    resultKind: "lineSeries",
    requires: [],
    params: [],
  };
}

const GROUPS: PickerGroup[] = [
  {
    category: { id: "structure", label: "Structure" },
    entries: [
      { analysis: definition("rdf.radial_distribution", "RDF") },
      { analysis: definition("msd.mean_squared_displacement", "MSD") },
    ],
  },
];

/** Rendered words, skipping injected `<style>` text from portalled primitives. */
function visibleText(root: Element): string[] {
  const out: string[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const owner = node.parentElement?.tagName ?? "";
    if (owner === "STYLE" || owner === "SCRIPT") continue;
    const text = (node.textContent ?? "").trim();
    if (text) out.push(text);
  }
  return out;
}

/** Copy a user can read: rendered text plus the accessible-name attributes. */
function copySurface(root: Element): string[] {
  const out: string[] = [];
  for (const el of [root, ...Array.from(root.querySelectorAll("*"))]) {
    for (const attr of ["aria-label", "placeholder", "title"]) {
      const value = el.getAttribute(attr);
      if (value) out.push(value);
    }
  }
  return [...out, ...visibleText(root)];
}

function trigger(host: ParentNode): HTMLElement {
  const el = host.querySelector<HTMLElement>('[data-slot="popover-trigger"]');
  if (!el) throw new Error("AnalysisPicker did not render a popover trigger");
  return el;
}

function popover(): HTMLElement {
  const el = document.body.querySelector<HTMLElement>(
    '[data-slot="popover-content"]',
  );
  if (!el) throw new Error("AnalysisPicker catalog did not open");
  return el;
}

function searchField(root: ParentNode): HTMLInputElement {
  const el = root.querySelector<HTMLInputElement>("input");
  if (!el) throw new Error("AnalysisPicker catalog has no search field");
  return el;
}

/** The catalog's "nothing matched" line — the counter line is not it. */
function emptySearchMessage(root: ParentNode): string | null {
  const lines = Array.from(root.querySelectorAll("p"))
    .map((p) => (p.textContent ?? "").trim())
    .filter((text) => text.length > 0 && !text.includes("available"));
  return lines[0] ?? null;
}

async function typeQuery(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  if (!setter) throw new Error("No value setter on HTMLInputElement");
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("AnalysisPicker", () => {
  it("user-facing copy says Compute", async () => {
    const { host, cleanup } = await mountComponent(
      <AnalysisPicker
        groups={GROUPS}
        selected={undefined}
        onSelect={() => undefined}
      />,
    );

    try {
      const closedCopy = copySurface(trigger(host));
      const triggerLabel = trigger(host).getAttribute("aria-label") ?? "";
      const triggerText = (trigger(host).textContent ?? "").trim();

      await act(async () => {
        trigger(host).click();
        await nextFrame();
      });
      const search = searchField(popover());
      const searchLabel = search.getAttribute("aria-label") ?? "";
      const searchPlaceholder = search.getAttribute("placeholder") ?? "";

      // A query that matches nothing surfaces the empty-catalog line.
      await typeQuery(search, "zzzz");
      const emptyLine = emptySearchMessage(popover()) ?? "";
      const openCopy = copySurface(popover());

      expect({
        analysisWordLeaks: [...closedCopy, ...openCopy].filter((piece) =>
          /analys/i.test(piece),
        ),
        saysCompute: {
          triggerLabel: /compute/i.test(triggerLabel),
          triggerText: /compute/i.test(triggerText),
          searchLabel: /compute/i.test(searchLabel),
          searchPlaceholder: /compute/i.test(searchPlaceholder),
          emptyLine: /compute/i.test(emptyLine),
        },
      }).toEqual({
        analysisWordLeaks: [],
        saysCompute: {
          triggerLabel: true,
          triggerText: true,
          searchLabel: true,
          searchPlaceholder: true,
          emptyLine: true,
        },
      });
    } finally {
      await cleanup();
    }
  });
});
