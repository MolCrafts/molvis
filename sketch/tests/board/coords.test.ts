import { describe, expect, it } from "@rstest/core";
import { ViewportCoords } from "../../src/board/coords";

describe("ViewportCoords", () => {
  it("dpr=2 css 200x100 yields backing 400x200", () => {
    const v = new ViewportCoords();
    v.resize(200, 100, 2);
    expect(v.getBackingStoreSize()).toEqual({ width: 400, height: 200 });
  });

  it("screenToDoc/docToScreen round-trip within 1e-6", () => {
    const v = new ViewportCoords();
    v.resize(200, 100, 1);
    v.setScale(40);
    v.setPan(0.5, -0.25);
    const doc = { x: 1.25, y: -0.75 };
    const scr = v.docToScreen(doc.x, doc.y);
    const back = v.screenToDoc(scr.x, scr.y);
    expect(back.x).toBeCloseTo(doc.x, 6);
    expect(back.y).toBeCloseTo(doc.y, 6);
  });
});
