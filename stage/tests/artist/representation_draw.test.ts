import { Color3, type Mesh, NullEngine, Scene } from "@babylonjs/core";
import { toDomainUint } from "@molcrafts/molvis-core";
import { Block, Frame } from "@molcrafts/molvis-core/molrs";
import { describe, expect, it } from "@rstest/core";
import "../setup_wasm";
import type { MolvisApp } from "../../src/app";
import type { LabelRenderer } from "../../src/artist/label_renderer";
import {
  drawBondsRepresentation,
  type RepresentationDrawHost,
} from "../../src/artist/representation_draw";
import { StyleManager } from "../../src/artist/style_manager";

const BOND_MESH_ID = 7;

interface RegisteredBondFrame {
  buffers: Map<string, Float32Array>;
  instanceCount: number;
}

/**
 * Host stub for the bond path. `registeredAtomColor` stands in for the atom
 * layer's `instanceColor` buffer in SceneIndex, which is always present —
 * `Artist.registerRuntimeLayers` creates both impostor states before any frame
 * lands in them — and holds the previous pass's contents whenever the atom
 * layer has not run yet.
 */
function makeHost(registeredAtomColor: Float32Array): {
  host: RepresentationDrawHost;
  registered: () => RegisteredBondFrame;
  styleManager: StyleManager;
} {
  const styleManager = new StyleManager(new Scene(new NullEngine()));
  let registered: RegisteredBondFrame | null = null;
  const host: RepresentationDrawHost = {
    app: {
      styleManager,
      world: {
        sceneIndex: {
          meshRegistry: {
            getAtomState: () => ({
              frameOffset: registeredAtomColor.length / 4,
              buffers: new Map([
                ["instanceColor", { data: registeredAtomColor, stride: 4 }],
              ]),
            }),
          },
          registerBondFrame: (options: RegisteredBondFrame) => {
            registered = {
              buffers: options.buffers,
              instanceCount: options.instanceCount,
            };
          },
        },
      },
    } as unknown as MolvisApp,
    atomMesh: null as unknown as Mesh,
    bondMesh: { uniqueId: BOND_MESH_ID } as unknown as Mesh,
    labelRenderer: null as unknown as LabelRenderer,
    ensureShadersForVisibleGeometry: async () => {},
    collectVisibleTargets: () => [],
    computeBondMIDisplacements: () => undefined,
  };
  return {
    host,
    styleManager,
    registered: () => {
      if (!registered) throw new Error("bond layer was never registered");
      return registered;
    },
  };
}

/** H–O–H with both O–H bonds, so the two endpoints differ by element. */
function makeWaterFrame(): Frame {
  const frame = new Frame();
  const atoms = new Block();
  atoms.set("x", new Float64Array([0, 0.96, -0.96]));
  atoms.set("y", new Float64Array([0, 0, 0]));
  atoms.set("z", new Float64Array([0, 0.3, 0.3]));
  atoms.set("element", ["O", "H", "H"]);
  frame.set("atoms", atoms);

  const bonds = new Block();
  bonds.set("atomi", toDomainUint([0, 0]));
  bonds.set("atomj", toDomainUint([1, 2]));
  bonds.set("bond_type", toDomainUint([1, 1]));
  bonds.set("bond_number", toDomainUint([1, 1]));
  frame.set("bonds", bonds);
  return frame;
}

function linear(element: string, styleManager: StyleManager): number[] {
  const c = Color3.FromHexString(
    styleManager.getAtomStyle(element).color,
  ).toLinearSpace();
  return [c.r, c.g, c.b];
}

function expectRgb(
  actual: Float32Array,
  expected: readonly number[],
  offset = 0,
): void {
  expect(actual[offset + 0]).toBeCloseTo(expected[0], 6);
  expect(actual[offset + 1]).toBeCloseTo(expected[1], 6);
  expect(actual[offset + 2]).toBeCloseTo(expected[2], 6);
}

describe("drawBondsRepresentation endpoint colors", () => {
  /**
   * Regression: `Bonds` draws ahead of `Particles` (both auto-attach into the
   * last execution band, in registry order), so the atom layer's registered
   * `instanceColor` belongs to the *previous* pass — a zeroed `capacity`
   * buffer on the first load. Reading it as the endpoint source painted every
   * stick with alpha 0 (the fragment shader's `discard`) up to the capacity
   * and NaN alpha past it (no blend resolves NaN into a visible stick). The
   * sticks were missing with nothing raised anywhere.
   *
   * The stub hands the bond layer exactly that poisoned buffer, so any future
   * code path that samples the atom layer's GPU state fails here.
   */
  it("resolves endpoint colors without reading the atom layer's buffer", async () => {
    const poison = new Float32Array(64 * 4);
    poison.fill(0);
    for (let i = 0; i < 64; i++) {
      poison[i * 4 + 0] = 0.9;
      poison[i * 4 + 1] = 0.1;
      poison[i * 4 + 2] = 0.4;
    }
    const { host, registered, styleManager } = makeHost(poison);

    await drawBondsRepresentation(host, makeWaterFrame());

    const buffers = registered().buffers;
    const col0 = buffers.get("instanceColor0")!;
    const col1 = buffers.get("instanceColor1")!;

    expectRgb(col0, linear("O", styleManager));
    expectRgb(col1, linear("H", styleManager));
    // The poison is neither copied into the sticks nor written in place.
    expect(col0[0]).not.toBeCloseTo(0.9, 3);
    expect(poison[0]).toBeCloseTo(0.9, 6);
  });

  it("keeps every endpoint color finite and opaque", async () => {
    // The invisible-stick symptom is a non-finite alpha, not a geometry bug:
    // the shader's `vColor0.a < 0.01` test cannot see NaN.
    const { host, registered } = makeHost(new Float32Array(64 * 4));

    await drawBondsRepresentation(host, makeWaterFrame());

    const buffers = registered().buffers;
    for (const name of ["instanceColor0", "instanceColor1"]) {
      const colors = buffers.get(name)!;
      for (let i = 0; i < colors.length; i += 4) {
        expect(Number.isFinite(colors[i])).toBe(true);
        expect(colors[i + 3]).toBe(1);
      }
    }
  });

  it("samples per-atom color overrides from the frame block", async () => {
    // ColorByProperty / ColorByCluster stamp these columns onto the frame.
    // They are the reason the split pass exists, so they must reach the sticks.
    const frame = makeWaterFrame();
    const atoms = frame.get("atoms")!;
    atoms.set("__color_r", new Float64Array([0.2, 0.4, 0.6]));
    atoms.set("__color_g", new Float64Array([0.1, 0.3, 0.5]));
    atoms.set("__color_b", new Float64Array([0.05, 0.15, 0.25]));
    const { host, registered } = makeHost(new Float32Array(64 * 4));

    await drawBondsRepresentation(host, frame);

    const col0 = registered().buffers.get("instanceColor0")!;
    const col1 = registered().buffers.get("instanceColor1")!;
    expectRgb(col0, [0.2, 0.1, 0.05]);
    expectRgb(col1, [0.4, 0.3, 0.15]);
  });
});
