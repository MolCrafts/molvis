import { describe, expect, it } from "@rstest/core";
import { ViewportCoords } from "../../src/board/coords";
import { SketchRenderer } from "../../src/board/sketch_renderer";
import { MoleculeGraph } from "../../src/molecule_graph";

function mockCtx() {
  const calls: string[] = [];
  const ctx = {
    setTransform: () => calls.push("setTransform"),
    clearRect: () => calls.push("clearRect"),
    fillRect: () => calls.push("fillRect"),
    strokeRect: () => calls.push("strokeRect"),
    beginPath: () => calls.push("beginPath"),
    arc: () => calls.push("arc"),
    fill: () => calls.push("fill"),
    stroke: () => calls.push("stroke"),
    moveTo: () => calls.push("moveTo"),
    lineTo: () => calls.push("lineTo"),
    closePath: () => calls.push("closePath"),
    rect: () => calls.push("rect"),
    setLineDash: (dash: number[]) => calls.push(`dash:${dash.join(",")}`),
    fillText: (t: string) => calls.push(`fillText:${t}`),
    measureText: (t: string) => ({ width: t.length * 8 }),
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    lineCap: "butt",
    lineJoin: "miter",
    font: "",
    textAlign: "start",
    textBaseline: "alphabetic",
    globalAlpha: 1,
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}

describe("SketchRenderer", () => {
  it("structure style: heteroatom labels, no C letter, no CPK balls on carbons", () => {
    const g = new MoleculeGraph();
    g.loadMoleculeData({
      atoms: [
        { element: "O", x: 0, y: 0 },
        { element: "H", x: 1, y: 0.5 },
        { element: "H", x: 1, y: -0.5 },
        { element: "C", x: -1, y: 0 },
      ],
      bonds: [
        { i: 0, j: 1, order: 1 },
        { i: 0, j: 2, order: 1 },
        { i: 0, j: 3, order: 1 },
      ],
    });
    const vp = new ViewportCoords();
    vp.resize(200, 200, 1);
    vp.setScale(40);
    const { ctx, calls } = mockCtx();
    new SketchRenderer().paint(ctx, g, vp, {
      selectedAtoms: new Set(),
      selectedBonds: new Set(),
      omitCarbonLabel: true,
      atomRadiusDoc: 0.35,
    });
    // Structure formula: letter labels for O/H, never C
    expect(calls.filter((c) => c.startsWith("fillText:O")).length).toBe(1);
    expect(calls.filter((c) => c.startsWith("fillText:H")).length).toBe(2);
    expect(calls.filter((c) => c.startsWith("fillText:C")).length).toBe(0);
    // No filled atom balls for bonded carbons — arcs only for label halos on O/H
    // (3 labeled atoms → 3 halo arcs). Carbon has no arc.
    expect(calls.filter((c) => c === "arc").length).toBe(3);
  });

  it("double bond emits parallel strokes", () => {
    const g = new MoleculeGraph();
    g.loadMoleculeData({
      atoms: [
        { element: "C", x: 0, y: 0 },
        { element: "C", x: 1.2, y: 0 },
      ],
      bonds: [{ i: 0, j: 1, order: 2 }],
    });
    const vp = new ViewportCoords();
    vp.resize(100, 100, 1);
    vp.setScale(40);
    const { ctx, calls } = mockCtx();
    new SketchRenderer().paint(ctx, g, vp, {
      selectedAtoms: new Set(),
      selectedBonds: new Set(),
      omitCarbonLabel: true,
      atomRadiusDoc: 0.35,
    });
    expect(calls.filter((c) => c === "stroke").length).toBeGreaterThanOrEqual(
      2,
    );
  });

  it("draws formal charge, gesture preview, and marquee feedback", () => {
    const g = new MoleculeGraph();
    g.loadMoleculeData({
      atoms: [{ element: "N", x: 0, y: 0, charge: 1 }],
      bonds: [],
    });
    const vp = new ViewportCoords();
    vp.resize(100, 100, 1);
    const { ctx, calls } = mockCtx();
    new SketchRenderer().paint(ctx, g, vp, {
      selectedAtoms: new Set([0]),
      selectedBonds: new Set(),
      omitCarbonLabel: true,
      atomRadiusDoc: 0.35,
      gesturePreview: {
        points: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
        ],
      },
      marquee: { x0: -1, y0: -1, x1: 1, y1: 1 },
    });
    expect(calls).toContain("fillText:+");
    expect(calls).not.toContain("fillText:⊕");
    expect(calls).toContain("rect");
    expect(calls).toContain("dash:5,4");
    expect(calls).toContain("dash:4,3");
  });

  it("renders custom colors on otherwise implicit carbon atoms", () => {
    const graph = new MoleculeGraph();
    graph.loadMoleculeData({
      atoms: [{ element: "C", x: 0, y: 0, color: "#7c3aed" }],
      bonds: [],
    });
    const viewport = new ViewportCoords();
    viewport.resize(100, 100, 1);
    const { ctx, calls } = mockCtx();
    new SketchRenderer().paint(ctx, graph, viewport, {
      selectedAtoms: new Set(),
      selectedBonds: new Set(),
      omitCarbonLabel: true,
      atomRadiusDoc: 0.35,
    });
    expect(calls.filter((call) => call === "arc")).toHaveLength(1);
  });

  it("does not draw colored endpoint arcs at bonded benzene carbons", () => {
    const color = "#7c3aed";
    const graph = new MoleculeGraph();
    graph.loadMoleculeData({
      atoms: [
        { element: "C", x: 1, y: 0, color },
        { element: "C", x: 0.5, y: 0.866, color },
        { element: "C", x: -0.5, y: 0.866, color },
        { element: "C", x: -1, y: 0, color },
        { element: "C", x: -0.5, y: -0.866, color },
        { element: "C", x: 0.5, y: -0.866, color },
      ],
      bonds: [
        { i: 0, j: 1, order: 2, color },
        { i: 1, j: 2, order: 1, color },
        { i: 2, j: 3, order: 2, color },
        { i: 3, j: 4, order: 1, color },
        { i: 4, j: 5, order: 2, color },
        { i: 5, j: 0, order: 1, color },
      ],
    });
    const viewport = new ViewportCoords();
    viewport.resize(160, 160, 1);
    viewport.setScale(40);
    const { ctx, calls } = mockCtx();
    new SketchRenderer().paint(ctx, graph, viewport, {
      selectedAtoms: new Set(),
      selectedBonds: new Set(),
      omitCarbonLabel: true,
      atomRadiusDoc: 0.35,
    });
    expect(calls.filter((call) => call === "arc")).toHaveLength(0);
  });
});
