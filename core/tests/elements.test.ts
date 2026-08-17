import { describe, expect, it } from "@rstest/core";
import {
  normalizeElement,
  PeriodicTable,
  PeriodicTableElements,
  VanDerWaalsRadii,
} from "../src/elements";

describe("elements catalog", () => {
  it("normalizes aromatic and mixed-case symbols", () => {
    expect(normalizeElement("c")).toBe("C");
    expect(normalizeElement("CL")).toBe("Cl");
    expect(normalizeElement("fe")).toBe("Fe");
  });

  it("has carbon and hydrogen entries", () => {
    expect(PeriodicTable.C?.name).toBe("Carbon");
    expect(PeriodicTable.H?.radius).toBeGreaterThan(0);
    expect(VanDerWaalsRadii.C).toBeGreaterThan(0);
  });

  it("contains all 118 unique element symbols", () => {
    expect(PeriodicTableElements).toHaveLength(118);
    expect(
      new Set(PeriodicTableElements.map((element) => element.symbol)).size,
    ).toBe(118);
  });

  it("orders atomic numbers continuously from 1 through 118", () => {
    expect(
      PeriodicTableElements.map((element) => element.atomicNumber),
    ).toEqual(Array.from({ length: 118 }, (_, index) => index + 1));
  });

  it("pins representative element metadata and grid positions", () => {
    const elementsBySymbol = new Map(
      PeriodicTableElements.map((element) => [element.symbol, element]),
    );

    expect(elementsBySymbol.get("H")).toMatchObject({
      symbol: "H",
      name: "Hydrogen",
      radius: 0.38,
      atomicNumber: 1,
      period: 1,
      group: 1,
      block: "s",
      row: 1,
      column: 1,
    });
    expect(elementsBySymbol.get("C")).toMatchObject({
      symbol: "C",
      name: "Carbon",
      radius: 0.77,
      atomicNumber: 6,
      period: 2,
      group: 14,
      block: "p",
      row: 2,
      column: 14,
    });
    expect(elementsBySymbol.get("La")).toMatchObject({
      symbol: "La",
      name: "Lanthanum",
      radius: 1.69,
      atomicNumber: 57,
      period: 6,
      group: null,
      block: "f",
      row: 8,
      column: 3,
    });
    expect(elementsBySymbol.get("Og")).toMatchObject({
      symbol: "Og",
      name: "Oganesson",
      radius: 1.06,
      atomicNumber: 118,
      period: 7,
      group: 18,
      block: "p",
      row: 7,
      column: 18,
    });
  });

  it("exposes a runtime-readonly element catalog", () => {
    expect(Object.isFrozen(PeriodicTableElements)).toBe(true);
    expect(
      PeriodicTableElements.every((element) => Object.isFrozen(element)),
    ).toBe(true);
  });
});
