import { describe, expect, it } from "@rstest/core";
import "../setup_wasm";
import {
  type ExplorationConfig,
  runExploration,
} from "../../src/analysis/exploration";

/**
 * Three well-separated blobs at the corners of an asymmetric triangle in a
 * 2-descriptor space, with a small jitter. The triangle is genuinely 2D (so
 * the embedding is not degenerate) yet the three corners stay well-separated
 * for clustering. Points are interleaved by index (i % 3) so cluster
 * assignment depends on geometry, not ordering.
 */
function makeBlobLabels(n: number): Map<string, Float64Array> {
  const centers: [number, number][] = [
    [0, 0],
    [12, 2],
    [3, 9],
  ];
  const a = new Float64Array(n);
  const b = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const [cx, cy] = centers[i % 3];
    const jitter = (i * 0.017) % 0.4;
    a[i] = cx + jitter;
    b[i] = cy - jitter;
  }
  return new Map([
    ["alpha", a],
    ["beta", b],
  ]);
}

const PCA_ONLY: ExplorationConfig = {
  descriptorNames: ["alpha", "beta"],
  reduction: { method: "pca" },
  clustering: { method: "none" },
  colorBy: { kind: "frame-index" },
};

describe("runExploration", () => {
  it("embeds the selected descriptors into ordered 2D coords", () => {
    const n = 51;
    const result = runExploration(makeBlobLabels(n), PCA_ONLY);

    expect(result.embedding.coords.length).toBe(2 * n);
    expect(result.descriptors.nFrames).toBe(n);
    expect(result.descriptors.nDescriptors).toBe(2);
    // Components come back in descending variance "by construction"; allow an
    // FP tolerance since near-isotropic clouds can tie to the last ULP.
    expect(result.embedding.variance[0]).toBeGreaterThanOrEqual(
      result.embedding.variance[1] - 1e-9,
    );
    expect(result.embedding.variance[0]).toBeGreaterThan(0);
    for (const v of result.embedding.coords) {
      expect(Number.isFinite(v)).toBe(true);
    }
    expect(result.clusters).toBe(null);
    expect(result.embedding.axes[0]).toMatch(/^PC1/);
  });

  it("labels three blobs into three clusters with a fixed seed", () => {
    const n = 51;
    const config: ExplorationConfig = {
      ...PCA_ONLY,
      clustering: { method: "kmeans", k: 3, seed: 42 },
    };
    const result = runExploration(makeBlobLabels(n), config);

    expect(result.clusters).not.toBe(null);
    expect(result.clusters?.length).toBe(n);
    const unique = new Set(Array.from(result.clusters ?? []));
    expect(unique.size).toBe(3);
  });

  it("is deterministic for a fixed seed", () => {
    const config: ExplorationConfig = {
      ...PCA_ONLY,
      clustering: { method: "kmeans", k: 3, seed: 42 },
    };
    const a = runExploration(makeBlobLabels(51), config);
    const b = runExploration(makeBlobLabels(51), config);
    expect(Array.from(a.clusters ?? [])).toEqual(Array.from(b.clusters ?? []));
  });

  it("throws when fewer than two descriptors are selected", () => {
    expect(() =>
      runExploration(makeBlobLabels(51), {
        ...PCA_ONLY,
        descriptorNames: ["alpha"],
      }),
    ).toThrow(/at least 2 descriptors/);
  });

  it("throws when a selected descriptor is missing from the map", () => {
    expect(() =>
      runExploration(makeBlobLabels(51), {
        ...PCA_ONLY,
        descriptorNames: ["alpha", "missing"],
      }),
    ).toThrow(/Unknown descriptor "missing"/);
  });

  it("throws when a selected column contains a non-finite value", () => {
    const labels = makeBlobLabels(51);
    labels.get("beta")?.fill(Number.NaN, 7, 8); // NaN at frame 7
    expect(() => runExploration(labels, PCA_ONLY)).toThrow(
      /non-finite value at frame 7/,
    );
  });

  it("throws when there are fewer than three frames", () => {
    const labels = new Map([
      ["alpha", new Float64Array([0, 1])],
      ["beta", new Float64Array([1, 0])],
    ]);
    expect(() => runExploration(labels, PCA_ONLY)).toThrow(/at least 3 frames/);
  });
});
