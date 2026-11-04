import { describe, expect, it } from "@rstest/core";
import { AtomLabel, chargeLabel } from "../../src/style/atom_label";

describe("AtomLabel", () => {
  it("puts hydrogens on the side away from the bonds", () => {
    const right = new AtomLabel(
      { element: "O", x: 0, y: 0, hydrogens: 1 },
      { x: 0, y: 0 },
      [{ x: -10, y: 0 }],
    );
    const left = new AtomLabel(
      { element: "O", x: 0, y: 0, hydrogens: 1 },
      { x: 0, y: 0 },
      [{ x: 10, y: 0 }],
    );
    const hRight = right.runs(20).find((r) => r.text === "H");
    const hLeft = left.runs(20).find((r) => r.text === "H");
    expect(hRight?.dx).toBeGreaterThan(0);
    expect(hLeft?.dx).toBeLessThan(0);
  });

  it("points the free direction away from the neighbors", () => {
    const label = new AtomLabel({ element: "C", x: 0, y: 0 }, { x: 0, y: 0 }, [
      { x: 10, y: 0 },
    ]);
    expect(label.freeDirection.x).toBeCloseTo(-1, 6);
    const lone = new AtomLabel(
      { element: "C", x: 0, y: 0 },
      { x: 0, y: 0 },
      [],
    );
    expect(lone.freeDirection).toEqual({ x: 0, y: -1 });
  });

  it("formats charges", () => {
    expect(chargeLabel(undefined)).toBe("");
    expect(chargeLabel(0)).toBe("");
    expect(chargeLabel(1)).toBe("+");
    expect(chargeLabel(2)).toBe("2+");
    expect(chargeLabel(-1)).toBe("−");
    expect(chargeLabel(-3)).toBe("3−");
  });
});
