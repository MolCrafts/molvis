import { describe, expect, it } from "@rstest/core";
import {
  normalizeInlineSource,
  parseMolvisStyleGallery,
  parseMolvisViewer,
} from "../src/element";
import { advanceGalleryCameraRotation } from "../src/gallery_camera";

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

describe("normalizeInlineSource", () => {
  it("strips pretty-print leading/trailing blank lines", () => {
    const pretty = `\n3\nname=water\nO  0.0000  0.0000  0.0000\nH  0.9572  0.0000  0.0000\nH -0.2390  0.9266  0.0000\n      `;
    const cleaned = normalizeInlineSource(pretty);
    expect(cleaned.startsWith("3\n")).toBe(true);
    expect(cleaned.endsWith("0.0000")).toBe(true);
    expect(cleaned).not.toMatch(/^\s/);
    expect(cleaned).not.toMatch(/\s$/);
  });
});

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
