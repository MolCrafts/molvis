import {
  NullEngine,
  Scene,
  StandardMaterial,
  TransformNode,
  Vector3,
} from "@babylonjs/core";
import { describe, expect, it } from "@rstest/core";
import {
  alignLocalAxisToWorld,
  paintAxisMaterial,
  WORLD_AXES,
  WORLD_AXIS_COLORS,
} from "../../src/gizmo/world_axes";

function withScene(run: (scene: Scene) => void): void {
  const engine = new NullEngine({
    renderWidth: 256,
    renderHeight: 256,
    textureSize: 512,
    deterministicLockstep: false,
    lockstepMaxSteps: 4,
  });
  const scene = new Scene(engine);
  try {
    run(scene);
  } finally {
    scene.dispose();
    engine.dispose();
  }
}

describe("WORLD_AXES", () => {
  it("defines the x/y/z triad with unit directions and the shared palette", () => {
    expect(WORLD_AXES.map((a) => a.key)).toEqual(["x", "y", "z"]);
    for (const axis of WORLD_AXES) {
      expect(axis.direction.length()).toBeCloseTo(1, 6);
      // Same Color3 instance as the palette — one source of truth.
      expect(axis.color).toBe(WORLD_AXIS_COLORS[axis.key]);
    }
    expect(
      WORLD_AXES[0].direction.equalsWithEpsilon(new Vector3(1, 0, 0)),
    ).toBe(true);
    expect(
      WORLD_AXES[1].direction.equalsWithEpsilon(new Vector3(0, 1, 0)),
    ).toBe(true);
    expect(
      WORLD_AXES[2].direction.equalsWithEpsilon(new Vector3(0, 0, 1)),
    ).toBe(true);
  });
});

describe("alignLocalAxisToWorld", () => {
  it("maps the local axis onto each world axis (torus-normal case)", () => {
    withScene((scene) => {
      const localNormal = new Vector3(0, -1, 0);
      for (const axis of WORLD_AXES) {
        const node = new TransformNode(`n-${axis.key}`, scene);
        alignLocalAxisToWorld(node, localNormal, axis.direction);
        const q = node.rotationQuaternion;
        expect(q).toBeTruthy();
        const world = localNormal.applyRotationQuaternion(q!);
        expect(world.x).toBeCloseTo(axis.direction.x, 5);
        expect(world.y).toBeCloseTo(axis.direction.y, 5);
        expect(world.z).toBeCloseTo(axis.direction.z, 5);
      }
    });
  });

  it("returns identity for already-parallel axes", () => {
    withScene((scene) => {
      const node = new TransformNode("parallel", scene);
      alignLocalAxisToWorld(node, new Vector3(1, 0, 0), new Vector3(1, 0, 0));
      const q = node.rotationQuaternion;
      expect(q?.x).toBeCloseTo(0, 6);
      expect(q?.y).toBeCloseTo(0, 6);
      expect(q?.z).toBeCloseTo(0, 6);
      expect(q?.w).toBeCloseTo(1, 6);
    });
  });

  it("handles the anti-parallel 180° case without collapsing", () => {
    withScene((scene) => {
      const node = new TransformNode("anti", scene);
      const local = new Vector3(0, 0, 1);
      const target = new Vector3(0, 0, -1);
      alignLocalAxisToWorld(node, local, target);
      const q = node.rotationQuaternion;
      expect(q).toBeTruthy();
      expect(q?.length()).toBeCloseTo(1, 6);
      const world = local.applyRotationQuaternion(q!);
      expect(world.x).toBeCloseTo(0, 5);
      expect(world.y).toBeCloseTo(0, 5);
      expect(world.z).toBeCloseTo(-1, 5);
    });
  });

  it("clears any stale Euler rotation so the quaternion is authoritative", () => {
    withScene((scene) => {
      const node = new TransformNode("stale", scene);
      node.rotation.set(0.5, 1.2, -0.3);
      alignLocalAxisToWorld(node, new Vector3(0, 0, 1), new Vector3(1, 0, 0));
      expect(node.rotation.x).toBe(0);
      expect(node.rotation.y).toBe(0);
      expect(node.rotation.z).toBe(0);
      expect(node.rotationQuaternion).toBeTruthy();
    });
  });
});

describe("paintAxisMaterial", () => {
  it("paints diffuse/emissive in the axis color with black specular", () => {
    withScene((scene) => {
      const mat = new StandardMaterial("m", scene);
      paintAxisMaterial(mat, WORLD_AXIS_COLORS.x);
      expect(mat.diffuseColor.r).toBeCloseTo(1, 6);
      expect(mat.diffuseColor.g).toBeCloseTo(0, 6);
      expect(mat.emissiveColor.r).toBeCloseTo(0.85, 6);
      expect(mat.specularColor.r).toBe(0);
      expect(mat.specularColor.g).toBe(0);
      expect(mat.specularColor.b).toBe(0);
    });
  });

  it("lightens the hover variant toward white without mutating the palette", () => {
    withScene((scene) => {
      const mat = new StandardMaterial("hover", scene);
      paintAxisMaterial(mat, WORLD_AXIS_COLORS.z, true);
      // Lerp(blue, white, 0.35) lifts red/green channels off zero.
      expect(mat.diffuseColor.r).toBeCloseTo(0.35, 6);
      expect(mat.diffuseColor.g).toBeCloseTo(0.35, 6);
      expect(mat.diffuseColor.b).toBeCloseTo(1, 6);
      // Shared palette must stay pure blue.
      expect(WORLD_AXIS_COLORS.z.r).toBe(0);
      expect(WORLD_AXIS_COLORS.z.g).toBe(0);
      expect(WORLD_AXIS_COLORS.z.b).toBe(1);
    });
  });
});
