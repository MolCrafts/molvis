import { Block, Frame, readEncodedFrame } from "@molcrafts/molvis-core/molrs";
import { describe, expect, it } from "@rstest/core";
import "../setup_wasm";
import type { MolvisApp } from "../../src/app";
import {
  COLOR_OVERRIDE_B,
  COLOR_OVERRIDE_G,
  COLOR_OVERRIDE_R,
} from "../../src/color_override_keys";
import { ColorByPropertyModifier } from "../../src/modifiers/ColorByPropertyModifier";
import { createDefaultContext } from "../../src/pipeline/types";

function makeFrame(types: string[]): Frame {
  const frame = new Frame();
  const atoms = new Block();
  atoms.set("x", new Float64Array(types.length));
  atoms.set("y", new Float64Array(types.length));
  atoms.set("z", new Float64Array(types.length));
  atoms.set("type", types);
  frame.set("atoms", atoms);
  return frame;
}

function extractTypeColors(
  frame: Frame,
): Map<string, [number, number, number]> {
  const atoms = frame.get("atoms")!;
  const types = atoms.copy("type") as string[];
  const r = atoms.view(COLOR_OVERRIDE_R) as Float64Array;
  const g = atoms.view(COLOR_OVERRIDE_G) as Float64Array;
  const b = atoms.view(COLOR_OVERRIDE_B) as Float64Array;
  const colors = new Map<string, [number, number, number]>();

  for (let i = 0; i < types.length; i++) {
    colors.set(types[i], [r[i], g[i], b[i]]);
  }
  return colors;
}

function colorDistance(
  a: [number, number, number],
  b: [number, number, number],
) {
  return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
}

const mockApp = {} as MolvisApp;

describe("ColorByPropertyModifier", () => {
  it("uses dataset-level categorical colors for string columns", () => {
    const mod = new ColorByPropertyModifier();
    mod.columnName = "type";

    const frameA = makeFrame(["opls_146", "opls_145", "opls_147"]);
    const frameB = makeFrame(["opls_147", "opls_145", "opls_146"]);

    const resultA = mod.apply(frameA, createDefaultContext(frameA, mockApp));
    const resultB = mod.apply(frameB, createDefaultContext(frameB, mockApp));

    const colorsA = extractTypeColors(resultA);
    const colorsB = extractTypeColors(resultB);

    expect(colorsA.get("opls_145")).toEqual(colorsB.get("opls_145"));
    expect(colorsA.get("opls_146")).toEqual(colorsB.get("opls_146"));
    expect(colorsA.get("opls_147")).toEqual(colorsB.get("opls_147"));
  });

  it("assigns clearly different colors to neighboring opls types", () => {
    const mod = new ColorByPropertyModifier();
    mod.columnName = "type";

    const frame = makeFrame(["opls_145", "opls_146", "opls_147"]);
    const result = mod.apply(frame, createDefaultContext(frame, mockApp));
    const colors = extractTypeColors(result);

    const diff145_146 = colorDistance(
      colors.get("opls_145")!,
      colors.get("opls_146")!,
    );
    const diff146_147 = colorDistance(
      colors.get("opls_146")!,
      colors.get("opls_147")!,
    );

    expect(diff145_146).toBeGreaterThan(0.1);
    expect(diff146_147).toBeGreaterThan(0.1);
  });

  it("gives a null row no override and keeps it out of the range", () => {
    // charge row 1 is null; its filled value (-100) must neither color the
    // atom nor stretch the ramp.
    const frame = frameWithNullableCharge([0, -100, 1], [true, false, true]);
    const mod = new ColorByPropertyModifier();
    mod.columnName = "charge";

    mod.inspect(frame);
    expect(mod.detectedRange).toEqual({ min: 0, max: 1 });

    const result = mod.apply(frame, createDefaultContext(frame, mockApp));
    const r = result.get("atoms")!.view(COLOR_OVERRIDE_R)!;
    expect(Number.isNaN(r[1])).toBe(true);
    expect(Number.isFinite(r[0])).toBe(true);
    expect(Number.isFinite(r[2])).toBe(true);
  });
});

/** Atoms with a nullable float `charge`, built from molrs JSON Frame bytes. */
function frameWithNullableCharge(charge: number[], valid: boolean[]): Frame {
  const n = charge.length;
  const f64 = (values: number[]) => ({
    dtype: "float",
    shape: [n],
    data: Array.from(new Uint8Array(new Float64Array(values).buffer)),
  });
  const zeros = new Array<number>(n).fill(0);
  const json = {
    blocks: {
      atoms: {
        shape: [n],
        columns: {
          x: f64(zeros),
          y: f64(zeros),
          z: f64(zeros),
          charge: f64(charge),
        },
        validity: { charge: valid },
      },
    },
    meta: {},
  };
  return readEncodedFrame(
    new TextEncoder().encode(JSON.stringify(json)),
    "json",
  );
}
