import type { Molvis } from "@molcrafts/molvis-stage";
import { describe, expect, it } from "@rstest/core";
import { act } from "react";
import { PipelineOperationProvider } from "../../../../../src/components/viewer/PipelineOperationProvider";
import { SolidLiquidModifier } from "../../../../../src/ui/modes/view/modifiers/SolidLiquidModifier";
import { mountComponent } from "../../../../react_harness";

function fakeModifier() {
  const liquid: string[] = [];
  const solid: string[] = [];
  return {
    modifier: {
      l: 6,
      cutoff: 3,
      normalizeQ: true,
      colorScene: false,
      liquidColor: "#4E79A7",
      solidColor: "#E15759",
      setL: () => undefined,
      setCutoff: () => undefined,
      setNormalizeQ: () => undefined,
      setColorScene: () => undefined,
      setLiquidColor: (v: string) => {
        liquid.push(v);
      },
      setSolidColor: (v: string) => {
        solid.push(v);
      },
    },
    liquid,
    solid,
  };
}

function fakeApp() {
  return { applyPipeline: async () => null } as unknown as Molvis;
}

describe("TestSolidLiquidModifier", () => {
  it("shows liquid/solid wells on draw even when colorScene is false", async () => {
    const { modifier, liquid, solid } = fakeModifier();
    const mounted = await mountComponent(
      <PipelineOperationProvider>
        <SolidLiquidModifier
          modifier={modifier as never}
          app={fakeApp()}
          onUpdate={() => undefined}
          surface="draw"
        />
      </PipelineOperationProvider>,
    );
    try {
      const liquidInput = mounted.host.querySelector<HTMLInputElement>(
        '[aria-label="Liquid color"]',
      );
      const solidInput = mounted.host.querySelector<HTMLInputElement>(
        '[aria-label="Solid color"]',
      );
      expect(liquidInput).not.toBeNull();
      expect(solidInput).not.toBeNull();
      await act(async () => {
        const desc = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        );
        desc?.set?.call(liquidInput, "#00ff00");
        liquidInput!.dispatchEvent(new Event("input", { bubbles: true }));
        liquidInput!.dispatchEvent(new Event("change", { bubbles: true }));
        desc?.set?.call(solidInput, "#0000ff");
        solidInput!.dispatchEvent(new Event("input", { bubbles: true }));
        solidInput!.dispatchEvent(new Event("change", { bubbles: true }));
      });
      expect(liquid).toContain("#00ff00");
      expect(solid).toContain("#0000ff");
    } finally {
      await mounted.cleanup();
    }
  });

  it("hides color wells on compute surface", async () => {
    const { modifier } = fakeModifier();
    const mounted = await mountComponent(
      <PipelineOperationProvider>
        <SolidLiquidModifier
          modifier={modifier as never}
          app={fakeApp()}
          onUpdate={() => undefined}
          surface="compute"
        />
      </PipelineOperationProvider>,
    );
    try {
      expect(
        mounted.host.querySelector('[aria-label="Liquid color"]'),
      ).toBeNull();
      expect(
        mounted.host.querySelector('[aria-label="Solid color"]'),
      ).toBeNull();
    } finally {
      await mounted.cleanup();
    }
  });
});
