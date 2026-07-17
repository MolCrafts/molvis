import { describe, expect, it } from "@rstest/core";
import { defaultMolvisConfig, isModeEnabled } from "../src/config";
import {
  defineMolvisStyleGallery,
  defineMolvisViewer,
  type MolvisStyleGalleryElement,
  type MolvisViewerElement,
  parseMolvisStyleGallery,
  parseMolvisViewer,
} from "../src/element";
import { ModeType } from "../src/mode";
import { advanceGalleryCameraRotation } from "../src/web_component_runtime";

function inlineViewer(attributes: Record<string, string> = {}): HTMLElement {
  const element = document.createElement("molvis-viewer");
  for (const [name, value] of Object.entries(attributes)) {
    element.setAttribute(name, value);
  }
  const template = document.createElement("template");
  template.setAttribute("data-molvis-source", "");
  template.content.textContent = "2\nH2\nH 0 0 0\nH 0 0 1";
  element.appendChild(template);
  return element;
}

function inlineGallery(attributes: Record<string, string> = {}): HTMLElement {
  const element = document.createElement("molvis-style-gallery");
  for (const [name, value] of Object.entries(attributes)) {
    element.setAttribute(name, value);
  }
  const template = document.createElement("template");
  template.setAttribute("data-molvis-source", "");
  template.content.textContent = "2\nH2\nH 0 0 0\nH 0 0 1";
  element.appendChild(template);
  return element;
}

describe("molvis-viewer author configuration", () => {
  it("parses inline source with safe embed defaults", () => {
    const element = inlineViewer({ format: "xyz" });
    const options = parseMolvisViewer(element);
    expect(options.content).toContain("H 0 0 1");
    expect(options.controls).toEqual(["view", "trajectory"]);
    expect(options.modes).toEqual(["view"]);
    expect(options.mode).toBe("view");
    expect(options.width).toBe("100%");
    expect(options.height).toBe("420px");
  });

  it("parses explicit controls, modes, and representation", () => {
    const options = parseMolvisViewer(
      inlineViewer({
        format: "pdb",
        controls: "view trajectory mode context-menu",
        modes: "view edit",
        mode: "edit",
        representation: "spacefill",
      }),
    );
    expect(options.controls).toContain("context-menu");
    expect(options.modes).toEqual(["view", "edit"]);
    expect(options.mode).toBe("edit");
    expect(options.representation).toBe("spacefill");
  });

  it("rejects ambiguous or unsafe declarations", () => {
    const both = inlineViewer({ format: "xyz", src: "molecule.xyz" });
    expect(() => parseMolvisViewer(both)).toThrow(/either src or inline/);
    expect(() => parseMolvisViewer(inlineViewer())).toThrow(
      /requires a format/,
    );
    expect(() =>
      parseMolvisViewer(inlineViewer({ format: "xyz", modes: "edit" })),
    ).toThrow(/must include "view"/);
    expect(() =>
      parseMolvisViewer(
        inlineViewer({ format: "xyz", controls: "view impossible" }),
      ),
    ).toThrow(/Invalid controls/);
  });
});

describe("molvis-viewer browser lifecycle", () => {
  it("keeps the loading root in the viewer's own layout", () => {
    defineMolvisViewer();
    const element = inlineViewer({ format: "xyz" }) as MolvisViewerElement;
    document.body.appendChild(element);

    const root = element.querySelector<HTMLElement>(
      "[data-molvis-viewer-root]",
    );
    expect(root?.style.position).toBe("relative");
    expect(root?.style.width).toBe("100%");
    expect(root?.style.height).toBe("100%");

    element.remove();
  });

  it("mounts inline XYZ through the real loader and disposes on detach", async () => {
    defineMolvisViewer();
    const element = inlineViewer({ format: "xyz" }) as MolvisViewerElement;
    element.style.width = "320px";
    element.style.height = "240px";
    const ready = new Promise<void>((resolve, reject) => {
      element.addEventListener("molvis:ready", () => resolve(), { once: true });
      element.addEventListener(
        "molvis:error",
        (event) =>
          reject((event as CustomEvent<{ error: Error }>).detail.error),
        { once: true },
      );
    });
    document.body.appendChild(element);
    await ready;
    const app = element.app;
    expect(app).toBeDefined();
    expect(app?.frame?.getBlock("atoms")?.nrows()).toBe(2);
    expect(element.querySelector("canvas")).toBeTruthy();

    element.remove();
    expect(element.app).toBeNull();
  });
});

describe("molvis-style-gallery", () => {
  it("defaults to every representation and validates read-only options", () => {
    const options = parseMolvisStyleGallery(
      inlineGallery({ format: "xyz", "rotation-speed": "0.05" }),
    );
    expect(options.representations).toHaveLength(10);
    expect(options.rotationSpeed).toBe(0.05);

    expect(() =>
      parseMolvisStyleGallery(
        inlineGallery({ format: "xyz", representations: "flat impossible" }),
      ),
    ).toThrow(/Invalid representations/);
    expect(() =>
      parseMolvisStyleGallery(
        inlineGallery({ format: "xyz", "rotation-speed": "-1" }),
      ),
    ).toThrow(/non-negative/);
  });

  it("mounts multiple canvases and scenes on exactly one engine", async () => {
    defineMolvisStyleGallery();
    const element = inlineGallery({
      format: "xyz",
      representations: "flat spacefill",
      "rotation-speed": "0",
    }) as MolvisStyleGalleryElement;
    const ready = new Promise<void>((resolve, reject) => {
      element.addEventListener("molvis:ready", () => resolve(), { once: true });
      element.addEventListener(
        "molvis:error",
        (event) =>
          reject((event as CustomEvent<{ error: Error }>).detail.error),
        { once: true },
      );
    });
    document.body.appendChild(element);
    await ready;

    expect(
      element.querySelectorAll("canvas.molvis-style-gallery__canvas"),
    ).toHaveLength(2);
    expect(element.apps).toHaveLength(2);
    expect(new Set(element.apps.map((app) => app.scene.getEngine())).size).toBe(
      1,
    );
    expect(element.apps[0].scene.getEngine()).toBe(element.engine);
    for (const app of element.apps) {
      expect(app.world.camera.beta).toBeCloseTo(Math.PI / 6, 6);
    }
    const preview = element.querySelector(".molvis-style-gallery__preview");
    expect(
      preview?.dispatchEvent(
        new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
      ),
    ).toBe(false);

    element.remove();
    expect(element.engine).toBeNull();
    expect(element.apps).toHaveLength(0);
  });

  it("advances every gallery camera at the configured automatic speed", () => {
    const cameras = [{ alpha: Math.PI / 4 }, { alpha: Math.PI / 4 }];
    for (const camera of cameras) {
      advanceGalleryCameraRotation(camera, 250, 2);
    }

    for (const camera of cameras) {
      expect(camera.alpha).toBeCloseTo(Math.PI / 4 + 0.5, 6);
    }
  });
});

describe("enabled interaction modes", () => {
  it("keeps ordinary core mounts backward compatible", () => {
    const config = defaultMolvisConfig();
    for (const mode of Object.values(ModeType)) {
      expect(isModeEnabled(config, mode)).toBe(true);
    }
  });

  it("blocks disabled modes and permits explicitly enabled modes", () => {
    const restricted = defaultMolvisConfig({ enabledModes: [ModeType.View] });
    expect(isModeEnabled(restricted, ModeType.View)).toBe(true);
    expect(isModeEnabled(restricted, ModeType.Edit)).toBe(false);

    const enabled = defaultMolvisConfig({
      enabledModes: [ModeType.View, ModeType.Edit],
    });
    expect(isModeEnabled(enabled, ModeType.Edit)).toBe(true);
  });
});
