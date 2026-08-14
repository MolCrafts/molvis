import type { Molvis } from "@molcrafts/molvis-stage";
import { describe, expect, it } from "@rstest/core";
import { act } from "react";
import { PipelineOperationProvider } from "../../../src/components/viewer/PipelineOperationProvider";
import { StageStyleSection } from "../../../src/ui/layout/StageStyleSection";
import { mountComponent } from "../../react_harness";

function copySurface(host: HTMLElement): string {
  const labels = Array.from(host.querySelectorAll("[aria-label]"))
    .map((el) => el.getAttribute("aria-label") ?? "")
    .join(" ");
  return `${host.textContent ?? ""} ${labels}`;
}

function fakeApp() {
  let theme: "tab10" | "ovito" = "tab10";
  const themes: string[] = [];
  const backgrounds: string[] = [];
  const events = { on: () => undefined, off: () => undefined };
  const app = {
    getCategoricalTheme: () => theme,
    setCategoricalTheme: (id: "tab10" | "ovito") => {
      theme = id;
      themes.push(id);
    },
    setBackgroundColor: (hex: string) => {
      backgrounds.push(hex);
    },
    styleManager: {
      getRepresentation: () => ({
        id: "ball-and-stick",
        name: "Ball and Stick",
        outlineEnabled: false,
        outlineConfigurable: true,
      }),
    },
    events,
    scene: { clearColor: { r: 0, g: 0, b: 0 } },
    applyPipeline: async () => null,
  } as unknown as Molvis;
  return { app, themes, backgrounds };
}

describe("TestStageStyleSection", () => {
  it("offers tab10 and ovito and does not mention Vivid/Classic/Modern", async () => {
    const { app } = fakeApp();
    const mounted = await mountComponent(
      <PipelineOperationProvider>
        <StageStyleSection app={app} />
      </PipelineOperationProvider>,
    );
    try {
      expect(mounted.host.querySelector('[aria-label="tab10"]')).not.toBeNull();
      expect(mounted.host.querySelector('[aria-label="ovito"]')).not.toBeNull();
      const copy = copySurface(mounted.host);
      expect(copy).not.toMatch(/Vivid|Classic|Modern/);
    } finally {
      await mounted.cleanup();
    }
  });

  it("calls setCategoricalTheme on click and leaves background alone", async () => {
    const { app, themes, backgrounds } = fakeApp();
    const mounted = await mountComponent(
      <PipelineOperationProvider>
        <StageStyleSection app={app} />
      </PipelineOperationProvider>,
    );
    try {
      await act(async () => {
        mounted.host
          .querySelector<HTMLButtonElement>('[aria-label="ovito"]')
          ?.click();
        await new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        });
      });
      expect(themes).toEqual(["ovito"]);
      expect(backgrounds).toEqual([]);
    } finally {
      await mounted.cleanup();
    }
  });

  it("background clicks do not change the categorical theme", async () => {
    const { app, themes, backgrounds } = fakeApp();
    const mounted = await mountComponent(
      <PipelineOperationProvider>
        <StageStyleSection app={app} />
      </PipelineOperationProvider>,
    );
    try {
      await act(async () => {
        mounted.host
          .querySelector<HTMLButtonElement>('[aria-label="Black"]')
          ?.click();
        await new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        });
      });
      expect(backgrounds.length).toBeGreaterThan(0);
      expect(themes).toEqual([]);
    } finally {
      await mounted.cleanup();
    }
  });

  it("shows Viewer not ready when app is null", async () => {
    const mounted = await mountComponent(
      <PipelineOperationProvider>
        <StageStyleSection app={null} />
      </PipelineOperationProvider>,
    );
    try {
      expect(mounted.host.textContent).toMatch(/Viewer not ready/);
    } finally {
      await mounted.cleanup();
    }
  });
});
