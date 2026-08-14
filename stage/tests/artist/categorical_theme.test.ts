import { describe, expect, it } from "@rstest/core";
import {
  OvitoStrategy,
  Tab10Strategy,
} from "../../src/artist/categorical_theme";
import { OVITO_ELEMENT_HEX } from "../../src/artist/palette";

describe("TestTab10Strategy", () => {
  const tab10 = new Tab10Strategy();

  it("assigns Tableau 10 by natural key order", () => {
    const map = tab10.colorForKeys(["opls_10", "opls_2", "opls_1"]);
    expect(map.get("opls_1")).toBe("#4E79A7");
    expect(map.get("opls_2")).toBe("#F28E2B");
    expect(map.get("opls_10")).toBe("#E15759");
  });

  it("ignores input order", () => {
    const a = tab10.colorForKeys(["opls_10", "opls_2", "opls_1"]);
    const b = tab10.colorForKeys(["opls_1", "opls_10", "opls_2"]);
    expect(a).toEqual(b);
  });

  it("deduplicates keys so repeats do not consume a slot", () => {
    const map = tab10.colorForKeys(["opls_1", "opls_1", "opls_2"]);
    expect(map.size).toBe(2);
    expect(map.get("opls_1")).toBe("#4E79A7");
    expect(map.get("opls_2")).toBe("#F28E2B");
  });

  it("cycles the eleventh natural-sorted key back to the first color", () => {
    const keys = Array.from({ length: 11 }, (_, i) => `t${i + 1}`);
    const map = tab10.colorForKeys(keys);
    expect(map.get("t11")).toBe("#4E79A7");
    expect(map.get("t1")).toBe("#4E79A7");
  });

  it("colorAt uses numericId modulo 10 and ignores the key", () => {
    expect(tab10.colorAt("ignored", 1)).toBe("#F28E2B");
    expect(tab10.colorAt("ignored")).toBe("#4E79A7");
  });

  it("returns a new Map without mutating the input", () => {
    const keys = ["a", "b"];
    const first = tab10.colorForKeys(keys);
    const second = tab10.colorForKeys(keys);
    expect(first).not.toBe(second);
    expect(keys).toEqual(["a", "b"]);
  });
});

describe("TestOvitoStrategy", () => {
  const ovito = new OvitoStrategy(OVITO_ELEMENT_HEX);

  it("maps integer type 1 (and equivalents) to salmon", () => {
    expect(ovito.colorAt("1")).toBe("#FF6666");
    expect(ovito.colorAt("01")).toBe("#FF6666");
    expect(ovito.colorAt("-1")).toBe("#FF6666");
    expect(ovito.colorAt("1", 5)).toBe("#FF6666");
  });

  it("wraps integer ids at 9", () => {
    expect(ovito.colorAt("9")).toBe("#F7F7F7");
    expect(ovito.colorAt("18")).toBe("#F7F7F7");
    expect(ovito.colorAt("10")).toBe("#FF6666");
  });

  it("looks up OVITO element colors for chemical symbols", () => {
    expect(ovito.colorAt("C")).toBe("#909090");
    expect(ovito.colorAt("Si")).toBe("#F0C8A0");
    expect(ovito.colorAt("Fe")).toBe("#E06633");
    expect(ovito.colorAt("H")).toBe("#FFFFFF");
    expect(ovito.colorAt("O")).toBe("#FF0D0D");
  });

  it("strips suffixes to reach an element symbol", () => {
    expect(ovito.colorAt("Si1")).toBe("#F0C8A0");
    expect(ovito.colorAt("si1")).toBe("#F0C8A0");
    expect(ovito.colorAt("Fe2+")).toBe("#E06633");
    expect(ovito.colorAt("C_1")).toBe("#909090");
    expect(ovito.colorAt("H2O")).toBe("#FFFFFF");
  });

  it("does not strip names longer than 5 characters", () => {
    expect(ovito.colorAt("Carbon")).toBe("#6666FF");
  });

  it("falls back to a stable hash for force-field names", () => {
    expect(ovito.colorAt("opls_145")).toBe("#6666FF");
    expect(ovito.colorAt("water")).toBe("#FFFF00");
    expect(ovito.colorAt("foo")).toBe("#CCFFB3");
  });

  it("uses numericId when the key is not an integer or element", () => {
    expect(ovito.colorAt("water", 1)).toBe("#FF6666");
  });

  it("colorForKeys assigns independently of order", () => {
    expect(ovito.colorForKeys([])).toEqual(new Map());
    const a = ovito.colorForKeys(["1", "C"]);
    const b = ovito.colorForKeys(["C", "1"]);
    expect(a.get("1")).toBe("#FF6666");
    expect(a.get("C")).toBe("#909090");
    expect(a).toEqual(b);
  });
});
