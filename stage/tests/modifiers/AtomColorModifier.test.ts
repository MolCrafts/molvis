import { Block, Frame } from "@molcrafts/molvis-core/molrs";
import { describe, expect, it } from "@rstest/core";
import "../setup_wasm";
import {
  COLOR_OVERRIDE_B,
  COLOR_OVERRIDE_G,
  COLOR_OVERRIDE_R,
} from "../../src/color_override_keys";
import { AtomColorModifier } from "../../src/modifiers/AtomColorModifier";

function makeFrame(n: number): Frame {
  const frame = new Frame();
  const atoms = new Block();
  atoms.set("x", new Float64Array(n));
  atoms.set("y", new Float64Array(n));
  atoms.set("z", new Float64Array(n));
  atoms.set(
    "element",
    Array.from({ length: n }, () => "C"),
  );
  frame.set("atoms", atoms);
  return frame;
}

function channels(frame: Frame): [Float64Array, Float64Array, Float64Array] {
  const atoms = frame.get("atoms");
  return [
    atoms.view(COLOR_OVERRIDE_R) as Float64Array,
    atoms.view(COLOR_OVERRIDE_G) as Float64Array,
    atoms.view(COLOR_OVERRIDE_B) as Float64Array,
  ];
}

describe("AtomColorModifier", () => {
  it("restores explicit colors from project parameters", () => {
    const source = new AtomColorModifier();
    source.assign([0], "#FF0000");
    source.assign([2], "#0000FF");
    const restored = new AtomColorModifier();
    restored.assign([1], "#00FF00");
    restored.fromProjectParams(
      JSON.parse(JSON.stringify(source.toProjectParams())),
    );
    const [r, g, b] = channels(restored.apply(makeFrame(3)));
    expect(r[0]).toBeCloseTo(1, 6);
    expect(Number.isNaN(g[1])).toBe(true);
    expect(b[2]).toBeCloseTo(1, 6);
    expect(restored.size).toBe(2);
  });

  it("preserves other blocks and metadata without mutating the input", () => {
    const frame = makeFrame(2);
    const forces = new Block();
    forces.set("fx", new Float64Array([2, 3]));
    frame.set("forces", forces);
    frame.setMeta("energy", -12);
    frame.setMeta("label", "sample");
    const mod = new AtomColorModifier();
    mod.assign([0], "#FF0000");
    const result = mod.apply(frame);
    expect(Array.from(result.get("forces").copy("fx") as Float64Array)).toEqual(
      [2, 3],
    );
    expect(result.getMeta("energy")).toBe(-12);
    expect(result.getMeta("label")).toBe("sample");
    expect(frame.get("atoms").has(COLOR_OVERRIDE_R)).toBe(false);
  });

  it("passes a frame through when it colors nothing", () => {
    const frame = makeFrame(3);
    expect(new AtomColorModifier().apply(frame)).toBe(frame);
  });

  it("colors only the named rows", () => {
    const mod = new AtomColorModifier();
    mod.assign([0, 2], "#FF0000");
    const [r, g, b] = channels(mod.apply(makeFrame(3)));
    expect(r[0]).toBeCloseTo(1, 6);
    expect(g[0]).toBeCloseTo(0, 6);
    expect(r[2]).toBeCloseTo(1, 6);
    expect(Number.isNaN(r[1])).toBe(true);
    expect(Number.isNaN(b[1])).toBe(true);
  });

  it("a later call recolors, null returns a row, reset forgets the rest", () => {
    const mod = new AtomColorModifier();
    mod.assign([0, 1], "#FF0000");
    mod.assign([1], "#0000FF");
    let [r, , b] = channels(mod.apply(makeFrame(2)));
    expect(r[0]).toBeCloseTo(1, 6);
    expect(b[1]).toBeCloseTo(1, 6);
    mod.assign([0], null);
    [r] = channels(mod.apply(makeFrame(2)));
    expect(Number.isNaN(r[0])).toBe(true);
    mod.assign([0], "#00FF00", { reset: true });
    expect(mod.size).toBe(1);
  });

  it("keeps an earlier override on rows it does not name", () => {
    const frame = makeFrame(2);
    const first = new AtomColorModifier("a");
    first.assign([1], "#00FF00");
    const second = new AtomColorModifier("b");
    second.assign([0], "#FF0000");
    const [r, g] = channels(second.apply(first.apply(frame)));
    expect(r[0]).toBeCloseTo(1, 6);
    expect(g[1]).toBeCloseTo(1, 6);
  });

  it("rejects a bad color or index and changes nothing", () => {
    const mod = new AtomColorModifier();
    mod.assign([0], "#FF0000");
    const key = mod.getCacheKey();
    expect(() => mod.assign([1], "red")).toThrow();
    expect(() => mod.assign([-1], "#00FF00")).toThrow();
    expect(() => mod.assign([0, 1.5], "#00FF00", { reset: true })).toThrow();
    expect(mod.getCacheKey()).toBe(key);
  });
});
