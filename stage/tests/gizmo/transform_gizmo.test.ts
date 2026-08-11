import {
  ArcRotateCamera,
  type DragStartEndEvent,
  NullEngine,
  Quaternion,
  Scene,
  Vector3,
} from "@babylonjs/core";
import { describe, expect, it } from "@rstest/core";
import {
  TransformGizmo,
  type TransformGizmoDragHandlers,
} from "../../src/gizmo/transform_gizmo";

const PIVOT_NAME = "molvis-transform-gizmo-pivot";

function setup(handlers?: Partial<TransformGizmoDragHandlers>): {
  scene: Scene;
  gizmo: TransformGizmo;
  disposeAll: () => void;
} {
  const engine = new NullEngine({
    renderWidth: 256,
    renderHeight: 256,
    textureSize: 512,
    deterministicLockstep: false,
    lockstepMaxSteps: 4,
  });
  const scene = new Scene(engine);
  scene.useRightHandedSystem = true;
  const camera = new ArcRotateCamera(
    "cam",
    Math.PI / 4,
    Math.PI / 3,
    10,
    Vector3.Zero(),
    scene,
  );
  camera.upVector = new Vector3(0, 0, 1);
  scene.activeCamera = camera;
  const gizmo = new TransformGizmo(scene, {
    onDragStart: handlers?.onDragStart ?? (() => {}),
    onDrag: handlers?.onDrag ?? (() => {}),
    onDragEnd: handlers?.onDragEnd ?? (() => {}),
  });
  return {
    scene,
    gizmo,
    disposeAll: () => {
      gizmo.dispose();
      scene.dispose();
      engine.dispose();
    },
  };
}

describe("TransformGizmo", () => {
  it("starts hidden with the rotate tool and no attachment", () => {
    const { scene, gizmo, disposeAll } = setup();
    try {
      expect(gizmo.getTool()).toBe("rotate");
      expect(gizmo.positionGizmo.attachedNode).toBeNull();
      expect(gizmo.rotationGizmo.attachedNode).toBeNull();
      expect(scene.getTransformNodeByName(PIVOT_NAME)?.isEnabled()).toBe(false);
      expect(gizmo.isPointerActive).toBe(false);
    } finally {
      disposeAll();
    }
  });

  it("show() attaches only the active tool at the pivot with the given diameter", () => {
    const { scene, gizmo, disposeAll } = setup();
    try {
      gizmo.show({ x: 1, y: 2, z: 3 }, 4);

      expect(gizmo.rotationGizmo.attachedNode).not.toBeNull();
      expect(gizmo.positionGizmo.attachedNode).toBeNull();
      // Babylon's ring is intrinsically 0.2 world units wide; a 4-unit
      // requested diameter must become scaleRatio 20, not 4 — the raw value
      // renders rings smaller than a single atom (missing-ring bug).
      expect(gizmo.rotationGizmo.scaleRatio).toBeCloseTo(20, 6);
      expect(scene.getTransformNodeByName(PIVOT_NAME)?.isEnabled()).toBe(true);

      const p = gizmo.pivotPosition;
      expect(p.x).toBeCloseTo(1, 6);
      expect(p.y).toBeCloseTo(2, 6);
      expect(p.z).toBeCloseTo(3, 6);
      // show() resets orientation so the next gesture is a pure delta.
      expect(gizmo.pivotRotation.w).toBeCloseTo(1, 6);
    } finally {
      disposeAll();
    }
  });

  it("setTool() while visible swaps the attachment immediately", () => {
    const { gizmo, disposeAll } = setup();
    try {
      gizmo.show({ x: 0, y: 0, z: 0 }, 2);
      gizmo.setTool("move");

      expect(gizmo.getTool()).toBe("move");
      expect(gizmo.positionGizmo.attachedNode).not.toBeNull();
      expect(gizmo.rotationGizmo.attachedNode).toBeNull();
    } finally {
      disposeAll();
    }
  });

  it("setTool() while hidden stays detached", () => {
    const { gizmo, disposeAll } = setup();
    try {
      gizmo.setTool("move");
      expect(gizmo.positionGizmo.attachedNode).toBeNull();
      expect(gizmo.rotationGizmo.attachedNode).toBeNull();
    } finally {
      disposeAll();
    }
  });

  it("setPose() parks position and rotation without touching attachment", () => {
    const { gizmo, disposeAll } = setup();
    try {
      gizmo.show({ x: 0, y: 0, z: 0 }, 2);
      const q = Quaternion.RotationAxis(new Vector3(0, 0, 1), Math.PI / 2);
      gizmo.setPose({ x: 5, y: 6, z: 7 }, q);

      const p = gizmo.pivotPosition;
      expect(p.x).toBeCloseTo(5, 6);
      expect(p.y).toBeCloseTo(6, 6);
      expect(p.z).toBeCloseTo(7, 6);
      expect(gizmo.pivotRotation.equalsWithEpsilon(q, 1e-6)).toBe(true);
      expect(gizmo.rotationGizmo.attachedNode).not.toBeNull();
    } finally {
      disposeAll();
    }
  });

  it("hide() detaches both tools and disables the pivot", () => {
    const { scene, gizmo, disposeAll } = setup();
    try {
      gizmo.show({ x: 1, y: 1, z: 1 }, 2);
      gizmo.hide();

      expect(gizmo.positionGizmo.attachedNode).toBeNull();
      expect(gizmo.rotationGizmo.attachedNode).toBeNull();
      expect(scene.getTransformNodeByName(PIVOT_NAME)?.isEnabled()).toBe(false);
    } finally {
      disposeAll();
    }
  });

  it("forwards drag events from both tools to the shared handlers", () => {
    const events: string[] = [];
    const { gizmo, disposeAll } = setup({
      onDragStart: () => events.push("start"),
      onDrag: () => events.push("drag"),
      onDragEnd: () => events.push("end"),
    });
    try {
      const event = {} as DragStartEndEvent;
      gizmo.positionGizmo.onDragStartObservable.notifyObservers(event);
      gizmo.rotationGizmo.onDragEndObservable.notifyObservers(event);
      expect(events).toEqual(["start", "end"]);
    } finally {
      disposeAll();
    }
  });
});
