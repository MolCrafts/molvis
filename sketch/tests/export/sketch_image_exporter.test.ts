import { describe, expect, it } from "@rstest/core";
import { DEFAULT_THEME } from "../../src/board/sketch_renderer";
import { SketchImageExporter } from "../../src/export/sketch_image_exporter";
import { MoleculeGraph } from "../../src/molecule_graph";
import { DEPICTION_TOKENS } from "../../src/style/depiction-tokens";
import type { MoleculeData } from "../../src/types";

function svgOf(data: MoleculeData): string {
  const graph = new MoleculeGraph();
  graph.loadMoleculeData(data);
  return new SketchImageExporter(graph, DEFAULT_THEME, true).toSvg();
}

function texts(svg: string): string[] {
  return [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]);
}

describe("SketchImageExporter.toSvg", () => {
  it("draws hydroxide as O, H and a minus charge", () => {
    const svg = svgOf({
      atoms: [{ element: "O", x: 0, y: 0, charge: -1, hydrogens: 1 }],
      bonds: [],
    });
    expect(texts(svg)).toEqual(["O", "H", "−"]);
    // Multi-letter label gets a rectangular knockout, not a one-letter disk.
    expect(svg).toContain("<rect x=");
  });

  it("writes an NH3 count as a subscript run and the charge after it", () => {
    const svg = svgOf({
      atoms: [
        { element: "C", x: 0, y: 0 },
        { element: "N", x: 1, y: 0, charge: 1, hydrogens: 3 },
      ],
      bonds: [{ i: 0, j: 1, order: 1 }],
    });
    // Bond comes from the left, so the hydrogens read to the right.
    expect(texts(svg)).toEqual(["N", "H", "3", "+"]);
  });

  it("marks a port atom with a dashed ring and its descriptor", () => {
    const svg = svgOf({
      atoms: [
        { element: "C", x: 0, y: 0, port: "<" },
        { element: "C", x: 1, y: 0 },
        { element: "O", x: 2, y: 0, port: "$R" },
      ],
      bonds: [
        { i: 0, j: 1, order: 1 },
        { i: 1, j: 2, order: 1 },
      ],
    });
    const ports = [
      ...svg.matchAll(/<g class="msk-port" data-port="([^"]*)">/g),
    ].map((m) => m[1]);
    expect(ports).toEqual(["&lt;", "$R"]);
    expect(svg).toContain(`stroke="${DEFAULT_THEME.portStroke}"`);
    const dash = svg.match(/stroke-dasharray="([\d.]+) ([\d.]+)"/);
    expect(dash).not.toBeNull();
    const [on, off] = [Number(dash?.[1]), Number(dash?.[2])];
    expect(on / off).toBeCloseTo(
      DEPICTION_TOKENS.portDashRatio[0] / DEPICTION_TOKENS.portDashRatio[1],
      2,
    );
  });

  it("leaves documents without ports or hydrogens unchanged in shape", () => {
    const svg = svgOf({
      atoms: [
        { element: "C", x: 0, y: 0 },
        { element: "Br", x: 1, y: 0 },
      ],
      bonds: [{ i: 0, j: 1, order: 1 }],
    });
    expect(svg).not.toContain("msk-port");
    // Br is wider than it is tall, so the knockout is a box the bond can meet.
    expect(svg).toContain("<rect x=");
    expect(texts(svg)).toEqual(["Br"]);
  });

  it("knocks a single letter out with a disk", () => {
    const svg = svgOf({
      atoms: [
        { element: "O", x: 0, y: 0 },
        { element: "C", x: 1, y: 0 },
      ],
      bonds: [{ i: 0, j: 1, order: 1 }],
    });
    expect(svg).toContain("<circle ");
    expect(svg).not.toContain("<rect x=");
    expect(texts(svg)).toEqual(["O"]);
  });
});
