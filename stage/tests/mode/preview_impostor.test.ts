import { describe, expect, it } from "@rstest/core";
import {
  PreviewAtomBuffers,
  PreviewBondBuffers,
} from "../../src/mode/preview_impostor_buffers";

function expectVec(actual: ArrayLike<number>, expected: readonly number[]) {
  expect(actual.length).toBe(expected.length);
  for (let i = 0; i < expected.length; i++) {
    expect(actual[i]).toBeCloseTo(expected[i] ?? 0);
  }
}

describe("PreviewAtomBuffers", () => {
  it("writes the sphere centre, diameter, and visible flag", () => {
    const buffers = new PreviewAtomBuffers();
    buffers.write(
      { x: 1, y: 2, z: 3 },
      0.4,
      { r: 0.2, g: 0.4, b: 0.6, a: 0.8 },
      0.5,
    );

    expectVec(buffers.instanceData, [1, 2, 3, 0.4]);
    expect(buffers.matrix[0]).toBeCloseTo(0.8);
    expect(buffers.matrix[5]).toBeCloseTo(0.8);
    expect(buffers.matrix[10]).toBeCloseTo(0.8);
    expect(buffers.matrix[15]).toBe(1);
    expect(buffers.matrix[12]).toBe(1);
    expect(buffers.matrix[13]).toBe(2);
    expect(buffers.matrix[14]).toBe(3);
    expectVec(buffers.instanceColor, [0.2, 0.4, 0.6, 0.4]);
    expect(buffers.instanceStyle[0]).toBe(1);
  });

  it("replaces the previous centre on the next write", () => {
    const buffers = new PreviewAtomBuffers();
    buffers.write({ x: 1, y: 2, z: 3 }, 0.4, { r: 1, g: 1, b: 1, a: 1 }, 1);
    buffers.write({ x: 4, y: 5, z: 6 }, 0.2, { r: 0, g: 0, b: 1, a: 1 }, 1);

    expectVec(buffers.instanceData, [4, 5, 6, 0.2]);
    expect(buffers.matrix[0]).toBeCloseTo(0.4);
    expect(buffers.matrix[12]).toBe(4);
    expect(buffers.instanceColor[2]).toBe(1);
  });
});

describe("PreviewBondBuffers", () => {
  it("writes the midpoint, unit direction, and endpoint colors", () => {
    const buffers = new PreviewBondBuffers();
    const wrote = buffers.write(
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 2, z: 0 },
      0.1,
      { r: 1, g: 0, b: 0, a: 1 },
      { r: 0, g: 0, b: 1, a: 0.5 },
      0.5,
    );

    expect(wrote).toBe(true);
    expectVec(buffers.instanceData0, [0, 1, 0, 0.1]);
    expect(buffers.instanceData1[0]).toBeCloseTo(0);
    expect(buffers.instanceData1[1]).toBeCloseTo(1);
    expect(buffers.instanceData1[2]).toBeCloseTo(0);
    expect(buffers.instanceData1[3]).toBeCloseTo(2);
    expect(buffers.matrix[0]).toBeCloseTo(2.2);
    expect(buffers.matrix[13]).toBeCloseTo(1);
    expectVec(buffers.instanceColor0, [1, 0, 0, 0.5]);
    expectVec(buffers.instanceColor1, [0, 0, 1, 0.25]);
    expect(buffers.instanceSplit[0]).toBe(0);
  });

  it("rejects a zero-length bond and keeps the previous numbers", () => {
    const buffers = new PreviewBondBuffers();
    buffers.write(
      { x: 0, y: 0, z: 0 },
      { x: 3, y: 0, z: 0 },
      0.1,
      { r: 1, g: 0, b: 0, a: 1 },
      { r: 0, g: 1, b: 0, a: 1 },
      1,
    );

    const wrote = buffers.write(
      { x: 1, y: 1, z: 1 },
      { x: 1, y: 1, z: 1 },
      0.1,
      { r: 0, g: 0, b: 0, a: 1 },
      { r: 0, g: 0, b: 0, a: 1 },
      1,
    );

    expect(wrote).toBe(false);
    expect(buffers.instanceData0[0]).toBeCloseTo(1.5);
    expect(buffers.instanceData1[0]).toBeCloseTo(1);
    expect(buffers.instanceData1[3]).toBeCloseTo(3);
  });
});
