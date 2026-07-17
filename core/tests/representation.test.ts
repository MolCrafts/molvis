import { describe, expect, it } from "@rstest/core";
import {
  findRepresentation,
  REPRESENTATION_IDS,
  REPRESENTATIONS,
  type RepresentationId,
} from "../src/artist/representation";
import { getVanDerWaalsRadius, isMetalElement } from "../src/system/elements";

describe("representation catalog", () => {
  it("exposes every rendering capability through a stable slug", () => {
    expect(REPRESENTATIONS.map((style) => style.id)).toEqual(
      REPRESENTATION_IDS,
    );
    expect(new Set(REPRESENTATION_IDS).size).toBe(10);
  });

  it("does not accept legacy names or aliases", () => {
    for (const legacy of ["Ball and Stick", "ball_and_stick", "stick"]) {
      expect(() => findRepresentation(legacy as RepresentationId)).toThrow(
        /Unknown representation/,
      );
    }
  });

  it("assigns capability-specific geometry policies", () => {
    expect(findRepresentation("spacefill").atomRadiusMode).toBe("vdw");
    expect(findRepresentation("tube").atomVisibility).toBe("tube-joints");
    expect(findRepresentation("metal-tube").atomVisibility).toBe(
      "metal-tube-joints",
    );
    expect(findRepresentation("skeletal").hideCarbonHydrogens).toBe(true);
    expect(findRepresentation("graph").bondOrderMode).toBe("single");
    for (const id of ["flat", "skeletal", "graph"] as const) {
      const representation = findRepresentation(id);
      expect(representation.outlineConfigurable).toBe(true);
      expect(representation.outlineEnabled).toBe(true);
      expect(
        representation.atomOutline + representation.bondOutline,
      ).toBeGreaterThan(0);
    }
  });
});

describe("physical element capabilities", () => {
  it("uses a genuine vdW radius table for spacefill", () => {
    expect(getVanDerWaalsRadius("C")).toBeCloseTo(1.91, 3);
    expect(getVanDerWaalsRadius("o")).toBeCloseTo(1.715, 3);
  });

  it("recognizes metals without classifying metalloids as metals", () => {
    expect(isMetalElement("Fe")).toBe(true);
    expect(isMetalElement("al")).toBe(true);
    expect(isMetalElement("Si")).toBe(false);
  });
});
