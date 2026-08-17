import type { Molvis } from "@molcrafts/molvis-stage";
import { describe, expect, it } from "@rstest/core";
import { act } from "react";
import { PipelineOperationProvider } from "../../../../../src/components/viewer/PipelineOperationProvider";
import { DrawRibbonModifier } from "../../../../../src/ui/modes/view/modifiers/DrawRibbonModifier";
import { mountComponent } from "../../../../react_harness";

function copySurface(host: HTMLElement): string {
  const labels = Array.from(host.querySelectorAll("[aria-label]"))
    .map((el) => el.getAttribute("aria-label") ?? "")
    .join(" ");
  return `${host.textContent ?? ""} ${labels}`;
}

function fakeModifier(colorMode: "ss" | "uniform" | "chain" = "ss") {
  const helix: string[] = [];
  const sheet: string[] = [];
  const coil: string[] = [];
  return {
    modifier: {
      colorMode,
      helixColor: [229 / 255, 83 / 255, 61 / 255],
      sheetColor: [240 / 255, 196 / 255, 25 / 255],
      coilColor: [125 / 255, 206 / 255, 122 / 255],
      uniformColor: [0.5, 0.5, 0.5],
      widthScale: 1,
      smoothness: 8,
      opacity: 1,
      setHelixColor: (v: string) => {
        helix.push(v);
      },
      setSheetColor: (v: string) => {
        sheet.push(v);
      },
      setCoilColor: (v: string) => {
        coil.push(v);
      },
      setUniformColor: () => undefined,
    },
    helix,
    sheet,
    coil,
  };
}

function fakeApp() {
  return {
    applyPipeline: async () => null,
    artist: { ribbonRenderer: { setOpacity: () => undefined } },
  } as unknown as Molvis;
}

describe("TestDrawRibbonModifier", () => {
  it("shows Cartoon copy and SS wells on draw when colorMode is ss", async () => {
    const { modifier, helix } = fakeModifier("ss");
    const mounted = await mountComponent(
      <PipelineOperationProvider>
        <DrawRibbonModifier
          modifier={modifier as never}
          app={fakeApp()}
          onUpdate={() => undefined}
          surface="draw"
        />
      </PipelineOperationProvider>,
    );
    try {
      const copy = copySurface(mounted.host);
      expect(copy).toMatch(/Cartoon/);
      expect(copy).not.toMatch(/\bRibbon\b/i);
      expect(
        mounted.host.querySelector('[aria-label="Helix color"]'),
      ).not.toBeNull();
      expect(
        mounted.host.querySelector('[aria-label="Sheet color"]'),
      ).not.toBeNull();
      expect(
        mounted.host.querySelector('[aria-label="Coil color"]'),
      ).not.toBeNull();

      const helixInput = mounted.host.querySelector<HTMLInputElement>(
        '[aria-label="Helix color"]',
      );
      await act(async () => {
        const desc = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        );
        desc?.set?.call(helixInput, "#112233");
        helixInput!.dispatchEvent(new Event("input", { bubbles: true }));
        helixInput!.dispatchEvent(new Event("change", { bubbles: true }));
      });
      expect(helix).toEqual(["#112233"]);
    } finally {
      await mounted.cleanup();
    }
  });

  it("hides SS wells on compute surface", async () => {
    const { modifier } = fakeModifier("ss");
    const mounted = await mountComponent(
      <PipelineOperationProvider>
        <DrawRibbonModifier
          modifier={modifier as never}
          app={fakeApp()}
          onUpdate={() => undefined}
          surface="compute"
        />
      </PipelineOperationProvider>,
    );
    try {
      expect(
        mounted.host.querySelector('[aria-label="Helix color"]'),
      ).toBeNull();
    } finally {
      await mounted.cleanup();
    }
  });

  it("does not show SS wells in uniform mode", async () => {
    const { modifier } = fakeModifier("uniform");
    const mounted = await mountComponent(
      <PipelineOperationProvider>
        <DrawRibbonModifier
          modifier={modifier as never}
          app={fakeApp()}
          onUpdate={() => undefined}
          surface="draw"
        />
      </PipelineOperationProvider>,
    );
    try {
      expect(
        mounted.host.querySelector('[aria-label="Helix color"]'),
      ).toBeNull();
      expect(
        mounted.host.querySelector('[aria-label="Cartoon uniform color"]'),
      ).not.toBeNull();
    } finally {
      await mounted.cleanup();
    }
  });
});
