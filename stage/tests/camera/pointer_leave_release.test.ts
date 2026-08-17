import { NullEngine } from "@babylonjs/core";
import { describe, expect, it } from "@rstest/core";
import { MolvisRenderer } from "../../src/renderer";

function mkRenderer(): MolvisRenderer {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  return new MolvisRenderer(canvas, { engine: new NullEngine() });
}

function leaveEvent(buttons: number, pointerType = "mouse"): PointerEvent {
  return new PointerEvent("pointerleave", {
    bubbles: true,
    cancelable: true,
    pointerId: 1,
    pointerType,
    isPrimary: true,
    clientX: 10,
    clientY: 10,
    button: 0,
    buttons,
  });
}

describe("World camera pointer-leave release", () => {
  it("keeps camera controls attached after forced release mid-drag", () => {
    const r = mkRenderer();
    try {
      const world = r.app.world;
      const camera = world.camera;
      expect(camera.inputs.attachedToElement).toBe(true);

      world.releaseCameraPointerDrag(leaveEvent(1));

      expect(camera.inputs.attachedToElement).toBe(true);
    } finally {
      r.dispose();
    }
  });

  it("does not re-attach camera when a mode has detached controls", () => {
    const r = mkRenderer();
    try {
      const world = r.app.world;
      const camera = world.camera;
      camera.detachControl();
      expect(camera.inputs.attachedToElement).toBe(false);

      world.releaseCameraPointerDrag(leaveEvent(1));

      expect(camera.inputs.attachedToElement).toBe(false);
    } finally {
      r.dispose();
    }
  });

  it("ignores hover leave (no buttons held)", () => {
    const r = mkRenderer();
    try {
      const world = r.app.world;
      const camera = world.camera;
      const detach = camera.detachControl.bind(camera);
      let detachCount = 0;
      camera.detachControl = () => {
        detachCount += 1;
        detach();
      };

      world.releaseCameraPointerDrag(leaveEvent(0));

      expect(detachCount).toBe(0);
      expect(camera.inputs.attachedToElement).toBe(true);
    } finally {
      r.dispose();
    }
  });

  it("ignores touch leave so multi-touch is not cancelled early", () => {
    const r = mkRenderer();
    try {
      const world = r.app.world;
      const camera = world.camera;
      const detach = camera.detachControl.bind(camera);
      let detachCount = 0;
      camera.detachControl = () => {
        detachCount += 1;
        detach();
      };

      world.releaseCameraPointerDrag(leaveEvent(1, "touch"));

      expect(detachCount).toBe(0);
      expect(camera.inputs.attachedToElement).toBe(true);
    } finally {
      r.dispose();
    }
  });

  it("pointerleave on the canvas ends a held mouse drag", () => {
    const r = mkRenderer();
    try {
      const canvas = r.app.canvas;
      const camera = r.app.world.camera;
      const detach = camera.detachControl.bind(camera);
      let detachCount = 0;
      camera.detachControl = () => {
        detachCount += 1;
        detach();
      };

      canvas.dispatchEvent(leaveEvent(1));

      expect(detachCount).toBe(1);
      expect(camera.inputs.attachedToElement).toBe(true);
    } finally {
      r.dispose();
    }
  });
});
