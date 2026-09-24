import type { Molvis } from "@molcrafts/molvis-stage";
import { describe, expect, it } from "@rstest/core";
import { PipelineOperationProvider } from "../../../../../src/components/viewer/PipelineOperationProvider";
import { MolecularSurfaceModifier } from "../../../../../src/ui/modes/view/modifiers/MolecularSurfaceModifier";
import { mountComponent } from "../../../../react_harness";

type Algorithm = "vdw" | "sas" | "ses" | "gaussian" | "hull" | "alpha";

interface FakeOverrides {
  algorithm?: Algorithm;
  report?: {
    shape: [number, number, number] | null;
    spacing: number | null;
    resolutionClamped: boolean;
    usedFallbackRadius: boolean;
    degenerate: boolean;
    triangleCount: number | null;
    tooManyAtoms: number | null;
  } | null;
}

function fakeModifier({
  algorithm = "ses",
  report = null,
}: FakeOverrides = {}) {
  return {
    algorithm,
    report,
    solventParams: { resolution: 0.5, probeRadius: 1.4, radiusScale: 1 },
    gaussianParams: { resolution: 0.5, sigma: 1, cutoff: null, isovalue: 0.05 },
    alphaParams: { probeRadius: 3, smoothing: 2 },
    setAlgorithm: () => undefined,
    setSolventParams: () => undefined,
    setGaussianParams: () => undefined,
    setAlphaParams: () => undefined,
  };
}

function fakeApp() {
  return { applyPipeline: async () => null } as unknown as Molvis;
}

async function mountPanel(overrides: FakeOverrides = {}) {
  return mountComponent(
    <PipelineOperationProvider>
      <MolecularSurfaceModifier
        modifier={fakeModifier(overrides) as never}
        app={fakeApp()}
        onUpdate={() => undefined}
        surface="compute"
      />
    </PipelineOperationProvider>,
  );
}

const has = (host: HTMLElement, label: string) =>
  host.querySelector(`[aria-label="${label}"]`) !== null;

describe("TestMolecularSurfaceModifier", () => {
  it("offers every algorithm as one flat list", async () => {
    const mounted = await mountPanel();
    try {
      expect(has(mounted.host, "Surface algorithm")).toBe(true);
    } finally {
      await mounted.cleanup();
    }
  });

  it("vdw shows radius scale but no probe radius", async () => {
    const mounted = await mountPanel({ algorithm: "vdw" });
    try {
      expect(has(mounted.host, "Resolution (Å) slider")).toBe(true);
      expect(has(mounted.host, "Radius scale slider")).toBe(true);
      expect(has(mounted.host, "Probe radius (Å) slider")).toBe(false);
      expect(has(mounted.host, "Sigma (Å) slider")).toBe(false);
    } finally {
      await mounted.cleanup();
    }
  });

  it("sas adds the probe radius", async () => {
    const mounted = await mountPanel({ algorithm: "sas" });
    try {
      expect(has(mounted.host, "Probe radius (Å) slider")).toBe(true);
      expect(has(mounted.host, "Radius scale slider")).toBe(true);
    } finally {
      await mounted.cleanup();
    }
  });

  it("ses adds the probe radius", async () => {
    const mounted = await mountPanel({ algorithm: "ses" });
    try {
      expect(has(mounted.host, "Probe radius (Å) slider")).toBe(true);
    } finally {
      await mounted.cleanup();
    }
  });

  it("gaussian swaps the whole solvent param set for its own", async () => {
    const mounted = await mountPanel({ algorithm: "gaussian" });
    try {
      expect(has(mounted.host, "Sigma (Å) slider")).toBe(true);
      expect(has(mounted.host, "Probe radius (Å) slider")).toBe(false);
      expect(has(mounted.host, "Radius scale slider")).toBe(false);
      expect(mounted.host.textContent ?? "").toMatch(/Cutoff/);
    } finally {
      await mounted.cleanup();
    }
  });

  it("isovalue is a Gaussian compute knob, not an appearance one", async () => {
    // It moves the geometry, so it sits with the algorithm. The solvent
    // envelopes have no equivalent: their surface is defined by radii.
    const density = await mountPanel({ algorithm: "gaussian" });
    try {
      expect(has(density.host, "Isovalue slider")).toBe(true);
    } finally {
      await density.cleanup();
    }

    const ses = await mountPanel({ algorithm: "ses" });
    try {
      expect(has(ses.host, "Isovalue slider")).toBe(false);
    } finally {
      await ses.cleanup();
    }
  });

  it("carries no appearance controls — those belong to Draw surface", async () => {
    // Colour and opacity must not re-run a Delaunay tetrahedralisation.
    const mounted = await mountPanel({ algorithm: "ses" });
    try {
      expect(has(mounted.host, "Opacity slider")).toBe(false);
      expect(mounted.host.querySelector('input[type="color"]')).toBeNull();
    } finally {
      await mounted.cleanup();
    }
  });

  it("reports the grid it actually built as one meta line", async () => {
    const mounted = await mountPanel({
      algorithm: "ses",
      report: {
        shape: [74, 61, 58],
        spacing: 0.5,
        resolutionClamped: false,
        usedFallbackRadius: false,
        degenerate: false,
        triangleCount: null,
        tooManyAtoms: null,
      },
    });
    try {
      const copy = mounted.host.textContent ?? "";
      expect(copy).toMatch(/74×61×58/);
      expect(copy).toMatch(/0\.5 Å/);
      expect(copy).not.toMatch(/coarsened/);
      expect(copy).not.toMatch(/uniform radius/);
    } finally {
      await mounted.cleanup();
    }
  });

  it("says so when the resolution was coarsened", async () => {
    const mounted = await mountPanel({
      algorithm: "ses",
      report: {
        shape: [160, 160, 160],
        spacing: 0.82,
        resolutionClamped: true,
        usedFallbackRadius: false,
        degenerate: false,
        triangleCount: null,
        tooManyAtoms: null,
      },
    });
    try {
      expect(mounted.host.textContent ?? "").toMatch(/coarsened/);
    } finally {
      await mounted.cleanup();
    }
  });

  it("warns about a uniform radius only where radii matter", async () => {
    const report = {
      shape: [40, 40, 40] as [number, number, number],
      spacing: 0.5,
      resolutionClamped: false,
      usedFallbackRadius: true,
      degenerate: false,
      triangleCount: null,
      tooManyAtoms: null,
    };

    const solvent = await mountPanel({ algorithm: "vdw", report });
    try {
      expect(solvent.host.textContent ?? "").toMatch(/uniform radius/);
    } finally {
      await solvent.cleanup();
    }

    // Gaussian density never reads van der Waals radii, so the warning
    // would be noise there.
    const density = await mountPanel({ algorithm: "gaussian", report });
    try {
      expect(density.host.textContent ?? "").not.toMatch(/uniform radius/);
    } finally {
      await density.cleanup();
    }
  });

  it("convex hull keeps radius scale but drops the grid resolution", async () => {
    const mounted = await mountPanel({ algorithm: "hull" });
    try {
      expect(has(mounted.host, "Radius scale slider")).toBe(true);
      expect(has(mounted.host, "Resolution (Å) slider")).toBe(false);
      expect(has(mounted.host, "Probe radius (Å) slider")).toBe(false);
      expect(has(mounted.host, "Sigma (Å) slider")).toBe(false);
    } finally {
      await mounted.cleanup();
    }
  });

  it("reports triangles for a mesh algorithm, not a grid", async () => {
    const mounted = await mountPanel({
      algorithm: "hull",
      report: {
        shape: null,
        spacing: null,
        resolutionClamped: false,
        usedFallbackRadius: false,
        degenerate: false,
        triangleCount: 1284,
        tooManyAtoms: null,
      },
    });
    try {
      const copy = mounted.host.textContent ?? "";
      expect(copy).toMatch(/1,284 triangles/);
      expect(copy).not.toMatch(/voxels/);
    } finally {
      await mounted.cleanup();
    }
  });

  it("says so when the atoms cannot span a volume", async () => {
    const mounted = await mountPanel({
      algorithm: "hull",
      report: {
        shape: null,
        spacing: null,
        resolutionClamped: false,
        usedFallbackRadius: false,
        degenerate: true,
        triangleCount: 0,
        tooManyAtoms: null,
      },
    });
    try {
      expect(mounted.host.textContent ?? "").toMatch(/do not span a volume/);
    } finally {
      await mounted.cleanup();
    }
  });

  it("alpha shape gets its own probe radius and a smoothing level", async () => {
    const mounted = await mountPanel({ algorithm: "alpha" });
    try {
      expect(has(mounted.host, "Probe radius (Å) slider")).toBe(true);
      expect(has(mounted.host, "Smoothing slider")).toBe(true);
      // It runs on atom centres, so radii and grids do not apply.
      expect(has(mounted.host, "Radius scale slider")).toBe(false);
      expect(has(mounted.host, "Resolution (Å) slider")).toBe(false);
    } finally {
      await mounted.cleanup();
    }
  });

  it("names the atom limit when alpha shape refuses a large frame", async () => {
    const mounted = await mountPanel({
      algorithm: "alpha",
      report: {
        shape: null,
        spacing: null,
        resolutionClamped: false,
        usedFallbackRadius: false,
        degenerate: true,
        triangleCount: 0,
        tooManyAtoms: 48000,
      },
    });
    try {
      const copy = mounted.host.textContent ?? "";
      expect(copy).toMatch(/48,000/);
      expect(copy).toMatch(/solvent surface/);
      // The size message replaces the generic one rather than stacking.
      expect(copy).not.toMatch(/do not span a volume/);
    } finally {
      await mounted.cleanup();
    }
  });

  it("tells an alpha user to raise the probe when nothing survived", async () => {
    const mounted = await mountPanel({
      algorithm: "alpha",
      report: {
        shape: null,
        spacing: null,
        resolutionClamped: false,
        usedFallbackRadius: false,
        degenerate: true,
        triangleCount: 0,
        tooManyAtoms: null,
      },
    });
    try {
      expect(mounted.host.textContent ?? "").toMatch(/larger one/);
    } finally {
      await mounted.cleanup();
    }
  });

  it("shows no grid meta line before the first run", async () => {
    const mounted = await mountPanel({ algorithm: "ses", report: null });
    try {
      expect(mounted.host.textContent ?? "").not.toMatch(/voxels/);
    } finally {
      await mounted.cleanup();
    }
  });
});
