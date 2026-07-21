import { describe, expect, it } from "@rstest/core";
import { normalizeInlineSource } from "../src/element";
import { loadTextTrajectory } from "../src/io/reader";
import "./setup_wasm";

// Pretty-printed template textContent (leading newline + trailing indent)
// used to surface as "XYZ len error: invalid atom count:" on molrs ≤0.8.2.
const PRETTY_TEMPLATE = `\n3\nname=water Connct="[0,1,0,2]"\nO  0.0000  0.0000  0.0000\nH  0.9572  0.0000  0.0000\nH -0.2390  0.9266  0.0000\n      `;

describe("theme example xyz", () => {
  it("normalizeInlineSource strips pretty-print blanks", () => {
    const cleaned = normalizeInlineSource(PRETTY_TEMPLATE);
    expect(cleaned.startsWith("3\n")).toBe(true);
    expect(cleaned.endsWith("0.0000")).toBe(true);
    expect(cleaned).not.toMatch(/^\s/);
    expect(cleaned).not.toMatch(/\s$/);
  });

  it("loads after normalize (docs template path)", () => {
    const bundle = loadTextTrajectory(
      normalizeInlineSource(PRETTY_TEMPLATE),
      "water.xyz",
    );
    try {
      expect(bundle.trajectory.length).toBe(1);
      expect(bundle.trajectory.get(0)?.getBlock("atoms")?.nrows()).toBe(3);
    } finally {
      bundle.dispose();
    }
  });
});
