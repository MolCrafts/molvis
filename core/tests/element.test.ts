import { describe, expect, it } from "@rstest/core";
import { defaultMolvisConfig, isModeEnabled } from "../src/config";
import {
  defineMolvisViewer,
  type MolvisViewerElement,
  parseMolvisViewer,
  representationName,
} from "../src/element";
import { ModeType } from "../src/mode";

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
    expect(representationName(options.representation)).toBe("Spacefill");
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
