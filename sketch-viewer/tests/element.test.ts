import { describe, expect, it } from "@rstest/core";
import { defineMolvisSketch, MolvisSketchElement } from "../src/element";

describe("defineMolvisSketch", () => {
  it("registers molvis-sketch once", () => {
    defineMolvisSketch();
    defineMolvisSketch();
    expect(customElements.get("molvis-sketch")).toBe(MolvisSketchElement);
  });
});

describe("MolvisSketchElement", () => {
  it("mounts a composer into the host and tears it down", () => {
    defineMolvisSketch();
    const host = document.createElement("molvis-sketch");
    document.body.appendChild(host);
    expect(host.querySelector(".molvis-sketch-composer")).not.toBeNull();
    host.remove();
    expect(host.querySelector(".molvis-sketch-composer")).toBeNull();
  });

  it("honours gui=false", () => {
    defineMolvisSketch();
    const host = document.createElement("molvis-sketch");
    host.setAttribute("gui", "false");
    document.body.appendChild(host);
    const root = host.querySelector(".molvis-sketch-composer");
    expect(root?.getAttribute("data-gui")).toBe("false");
    host.remove();
  });
});
