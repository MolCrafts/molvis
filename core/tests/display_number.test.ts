import { describe, expect, it } from "@rstest/core";
import { DisplayNumber } from "../src/display_number";

describe("DisplayNumber.format", () => {
  it("keeps one or two fraction digits and drops trailing zeros", () => {
    expect(new DisplayNumber(1.5).format()).toBe("1.5");
    expect(new DisplayNumber(1.234).format()).toBe("1.23");
    expect(new DisplayNumber(2).format()).toBe("2");
    expect(new DisplayNumber(12.34).format(1)).toBe("12.3");
  });

  it("maps non-finite and negative zero to a readable token", () => {
    expect(new DisplayNumber(Number.NaN).format()).toBe("NaN");
    expect(new DisplayNumber(Number.POSITIVE_INFINITY).format()).toBe(
      "Infinity",
    );
    expect(new DisplayNumber(-0).format()).toBe("0");
  });
});

describe("DisplayNumber.science", () => {
  it("keeps four significant figures in the ordinary range", () => {
    expect(new DisplayNumber(35.560415817765765).science()).toBe("35.56");
    expect(new DisplayNumber(-0.402947).science()).toBe("-0.4029");
    expect(new DisplayNumber(1.00800002).science()).toBe("1.008");
    expect(new DisplayNumber(16).science()).toBe("16");
    expect(new DisplayNumber(0.118213).science()).toBe("0.1182");
  });

  it("uses scientific notation outside [1e-3, 1e4)", () => {
    expect(new DisplayNumber(-2616795.3284783973).science()).toBe("-2.617e6");
    expect(new DisplayNumber(0.0003581062).science()).toBe("3.581e-4");
    expect(new DisplayNumber(1e4).science()).toBe("1.000e4");
  });

  it("maps zero and non-finite values", () => {
    expect(new DisplayNumber(0).science()).toBe("0");
    expect(new DisplayNumber(-0).science()).toBe("0");
    expect(new DisplayNumber(Number.NaN).science()).toBe("NaN");
  });
});
