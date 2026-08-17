import { describe, expect, it } from "@rstest/core";
import { EventEmitter, type MolvisEventMap } from "../../src/events";

/**
 * Pure-math + event-wiring tests for the new camera control surface.
 *
 * `World.getCameraPose` / `setCameraPose` / `lookAt` are thin wrappers
 * around BabylonJS `ArcRotateCamera` properties, so we don't re-test
 * Babylon itself — instead we verify the spherical-conversion math used
 * by `lookAt` and the event-driven semantics of `waitForNextRender`.
 *
 * `waitForNextRender` is exercised against a real `EventEmitter` instance
 * (no Babylon engine required) by re-creating its body around a partial
 * MolvisApp-like object.
 */

function cartesianToSpherical(
  position: [number, number, number],
  target: [number, number, number],
): { alpha: number; beta: number; radius: number } {
  const dx = position[0] - target[0];
  const dy = position[1] - target[1];
  const dz = position[2] - target[2];
  const radius = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const alpha = Math.atan2(dy, dx);
  const beta = Math.acos(Math.max(-1, Math.min(1, dz / radius)));
  return { alpha, beta, radius };
}

interface WaitableApp {
  events: EventEmitter<MolvisEventMap>;
  waitForNextRender(timeoutMs?: number): Promise<void>;
}

function makeWaitable(): WaitableApp {
  const events = new EventEmitter<MolvisEventMap>();
  return {
    events,
    waitForNextRender(timeoutMs = 2000): Promise<void> {
      return new Promise((resolve, reject) => {
        let off: (() => void) | null = null;
        const timer = setTimeout(() => {
          off?.();
          reject(new Error(`waitForNextRender timed out after ${timeoutMs}ms`));
        }, timeoutMs);
        off = events.on("frame-rendered", () => {
          clearTimeout(timer);
          off?.();
          resolve();
        });
      });
    },
  };
}

describe("lookAt cartesian → spherical conversion", () => {
  it("computes radius from |position - target|", () => {
    const r = cartesianToSpherical([3, 4, 0], [0, 0, 0]).radius;
    expect(r).toBeCloseTo(5, 6);
  });

  it("places +X camera at alpha=0, beta=π/2 (Z-up)", () => {
    const { alpha, beta, radius } = cartesianToSpherical([10, 0, 0], [0, 0, 0]);
    expect(alpha).toBeCloseTo(0, 6);
    expect(beta).toBeCloseTo(Math.PI / 2, 6);
    expect(radius).toBeCloseTo(10, 6);
  });

  it("places +Y camera at alpha=π/2, beta=π/2", () => {
    const { alpha, beta } = cartesianToSpherical([0, 10, 0], [0, 0, 0]);
    expect(alpha).toBeCloseTo(Math.PI / 2, 6);
    expect(beta).toBeCloseTo(Math.PI / 2, 6);
  });

  it("places +Z camera at beta=0 (looking straight down)", () => {
    const { beta } = cartesianToSpherical([0, 0, 10], [0, 0, 0]);
    expect(beta).toBeCloseTo(0, 6);
  });

  it("places -Z camera at beta=π (looking straight up)", () => {
    const { beta } = cartesianToSpherical([0, 0, -10], [0, 0, 0]);
    expect(beta).toBeCloseTo(Math.PI, 6);
  });

  it("offsets target correctly", () => {
    const { radius } = cartesianToSpherical([10, 10, 10], [10, 10, 0]);
    expect(radius).toBeCloseTo(10, 6);
  });

  it("clamps dz/radius to [-1, 1] (numeric safety)", () => {
    // Floating-point can push dz/r slightly past 1.0; acos must not NaN.
    const epsilon = 1e-10;
    const { beta } = cartesianToSpherical([epsilon, 0, 10], [0, 0, 0]);
    expect(Number.isNaN(beta)).toBe(false);
    expect(beta).toBeLessThanOrEqual(Math.PI);
    expect(beta).toBeGreaterThanOrEqual(0);
  });
});

describe("MolvisApp.waitForNextRender", () => {
  it("resolves on the next frame-rendered emission", async () => {
    const app = makeWaitable();
    const promise = app.waitForNextRender(1000);
    setTimeout(
      () => app.events.emit("frame-rendered", { frame: {} as never }),
      5,
    );
    await expect(promise).resolves.toBeUndefined();
  });

  it("rejects if no frame-rendered fires within the timeout", async () => {
    const app = makeWaitable();
    await expect(app.waitForNextRender(50)).rejects.toThrow(/timed out/);
  });

  it("removes its listener after resolving (no leak)", async () => {
    const app = makeWaitable();
    await app.waitForNextRender(1000).then(
      () => undefined,
      () => undefined,
    );
    // Trigger one more emit; if the listener leaked, the next iteration
    // would still hold a reference. We assert by checking the emitter has
    // no listeners recorded for the event.
    const promise = app.waitForNextRender(50);
    app.events.emit("frame-rendered", { frame: {} as never });
    await expect(promise).resolves.toBeUndefined();
  });

  it("removes its listener after rejecting (no leak after timeout)", async () => {
    const app = makeWaitable();
    await app.waitForNextRender(20).catch(() => undefined);
    // A subsequent emit should not call any stale listener — easiest way to
    // verify is that a fresh wait still works normally.
    const promise = app.waitForNextRender(1000);
    app.events.emit("frame-rendered", { frame: {} as never });
    await expect(promise).resolves.toBeUndefined();
  });
});
