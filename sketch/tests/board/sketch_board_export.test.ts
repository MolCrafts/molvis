import { describe, expect, it } from "@rstest/core";
import { SketchBoard } from "../../src/board/sketch_board";

function oxygenChainBoard(): SketchBoard {
  const board = new SketchBoard();
  board.loadMoleculeData({
    atoms: [
      { element: "C", x: -1, y: 0 },
      { element: "O", x: 0, y: 0, charge: -1, color: "#dc2626" },
      { element: "C", x: 1, y: 0 },
    ],
    bonds: [
      { i: 0, j: 1, order: 1 },
      { i: 1, j: 2, order: 2, color: "#2563eb" },
    ],
  });
  return board;
}

describe("SketchBoard image export", () => {
  it("exports a fitted, standalone SVG without editor selection chrome", () => {
    const svg = oxygenChainBoard().toSvg({
      width: 320,
      height: 200,
      padding: 24,
    });

    expect(svg).toContain('<svg xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain('width="320"');
    expect(svg).toContain('height="200"');
    expect(svg).toContain('viewBox="0 0 320 200"');
    expect(svg).toContain("#2563eb");
    expect(svg).toContain("#dc2626");
    expect(svg).toContain(">O</text>");
    expect(svg).toContain(">−</text>");
    expect(svg).not.toContain(">C</text>");
    expect(svg).not.toContain("selection");
  });

  it("exports a non-empty PNG blob at the requested dimensions", async () => {
    const blob = await oxygenChainBoard().toPng({
      width: 160,
      height: 120,
      padding: 16,
      pixelRatio: 1,
    });

    expect(blob.type).toBe("image/png");
    expect(blob.size).toBeGreaterThan(100);
    const bitmap = await createImageBitmap(blob);
    expect(bitmap.width).toBe(160);
    expect(bitmap.height).toBe(120);
    bitmap.close();
  });
});
