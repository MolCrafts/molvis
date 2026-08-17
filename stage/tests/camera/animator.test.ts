import {
  ArcRotateCamera,
  type Camera,
  NullEngine,
  Scene,
  UniversalCamera,
  Vector3,
} from "@babylonjs/core";
import { describe, expect, it } from "@rstest/core";
import { CameraAnimator } from "../../src/camera/animator";
import { TurntableTrack } from "../../src/camera/track";

/**
 * Lifecycle + view-preservation tests for CameraAnimator. The animator drives
 * its OWN UniversalCamera and never mutates the user's interactive
 * ArcRotateCamera; play/stop register/unregister exactly one render observer;
 * renderFrames is counter-driven and restores the main camera even on error.
 */

interface Harness {
  scene: Scene;
  mainCamera: ArcRotateCamera;
  animator: CameraAnimator;
  renderOnceCalls: { n: number };
  dispose(): void;
}

const VIEWPORT = { fieldOfView: 0.8, nearClipPlane: 0.1, farClipPlane: 1000 };

function makeHarness(): Harness {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const mainCamera = new ArcRotateCamera(
    "main",
    Math.PI / 4,
    Math.PI / 3,
    10,
    Vector3.Zero(),
    scene,
  );
  scene.activeCamera = mainCamera;
  const renderOnceCalls = { n: 0 };
  const animator = new CameraAnimator({
    scene,
    mainCamera,
    viewport: VIEWPORT,
    renderOnce: () => {
      renderOnceCalls.n += 1;
    },
    getBounds: () => ({
      min: { x: -5, y: -5, z: -5 },
      max: { x: 5, y: 5, z: 5 },
    }),
    getAspectRatio: (_cam: Camera) => 1.0,
  });
  return {
    scene,
    mainCamera,
    animator,
    renderOnceCalls,
    dispose: () => {
      animator.dispose();
      scene.dispose();
      engine.dispose();
    },
  };
}

function makeTrack(): TurntableTrack {
  return new TurntableTrack({
    center: [0, 0, 0],
    radius: 10,
    duration: 4,
    revolutions: 1,
  });
}

describe("CameraAnimator construction (ac-013)", () => {
  it("animCamera takes its fov/minZ/maxZ from the viewport config", () => {
    const h = makeHarness();
    expect(h.animator.animCamera).toBeInstanceOf(UniversalCamera);
    expect(h.animator.animCamera.fov).toBeCloseTo(VIEWPORT.fieldOfView, 6);
    expect(h.animator.animCamera.minZ).toBeCloseTo(VIEWPORT.nearClipPlane, 6);
    expect(h.animator.animCamera.maxZ).toBeCloseTo(VIEWPORT.farClipPlane, 6);
    h.dispose();
  });
});

describe("CameraAnimator owns its own light (ac-011)", () => {
  it("creates a DirectionalLight parented to animCamera with the main rig's values", () => {
    const h = makeHarness();
    const light = h.scene.getLightByName("animDirLight");
    expect(light).not.toBeNull();
    expect(light?.parent).toBe(h.animator.animCamera);
    expect(light?.intensity).toBeCloseTo(0.48, 6);
    expect(light?.specular.r).toBeCloseTo(0.6, 6);
    expect(light?.specular.g).toBeCloseTo(0.6, 6);
    expect(light?.specular.b).toBeCloseTo(0.6, 6);
    h.dispose();
  });
});

describe("seek does not mutate the main ArcRotateCamera (ac-006)", () => {
  it("leaves alpha/beta/radius untouched", () => {
    const h = makeHarness();
    h.animator.play(makeTrack());
    const a = h.mainCamera.alpha;
    const b = h.mainCamera.beta;
    const r = h.mainCamera.radius;
    h.animator.seek(0.5);
    expect(h.mainCamera.alpha).toBeCloseTo(a, 6);
    expect(h.mainCamera.beta).toBeCloseTo(b, 6);
    expect(h.mainCamera.radius).toBeCloseTo(r, 6);
    h.dispose();
  });
});

describe("play/stop observer lifecycle (ac-007, ac-008)", () => {
  it("play twice registers exactly one observer; stop makes it inert", () => {
    const h = makeHarness();
    const obs = h.scene.onBeforeRenderObservable;
    const baseline = obs.observers.length;

    // Spy on seek so we can detect whether the render-loop callback fires.
    let seekCalls = 0;
    const orig = h.animator.seek.bind(h.animator);
    h.animator.seek = (t: number) => {
      seekCalls += 1;
      orig(t);
    };

    h.animator.play(makeTrack());
    h.animator.play(makeTrack());
    // Double-add guard: a second play() must not register a second observer.
    expect(obs.observers.length - baseline).toBe(1);
    expect(h.animator.isPlaying).toBe(true);

    // A render tick drives the active observer → seek fires.
    seekCalls = 0;
    obs.notifyObservers(h.scene);
    expect(seekCalls).toBeGreaterThan(0);

    h.animator.stop();
    expect(h.animator.isPlaying).toBe(false);

    // After stop the observer is removed: a further tick must NOT advance it.
    // (Babylon's `.observers` array length is an unreliable metric here — it
    // does not shrink — so we verify removal behaviorally.)
    seekCalls = 0;
    obs.notifyObservers(h.scene);
    expect(seekCalls).toBe(0);
    h.dispose();
  });

  it("stop restores scene.activeCamera to the main camera", () => {
    const h = makeHarness();
    h.animator.play(makeTrack());
    expect(h.scene.activeCamera).toBe(h.animator.animCamera);
    h.animator.stop();
    expect(h.scene.activeCamera).toBe(h.mainCamera);
    h.dispose();
  });
});

describe("renderFrames is counter-driven (ac-010, ac-012)", () => {
  it("seeks i/total per frame, renders once per frame, returns total dataURLs", async () => {
    const h = makeHarness();
    const seekCalls: number[] = [];
    const orig = h.animator.seek.bind(h.animator);
    h.animator.seek = (t: number) => {
      seekCalls.push(t);
      orig(t);
    };
    const frames = await h.animator.renderFrames(
      { duration: 1, fps: 10, revolutions: 1 },
      async () => "data:image/png;base64,xxx",
    );
    expect(frames.length).toBe(10);
    // seek called once per frame with i/total
    const fromRender = seekCalls.slice(-10);
    expect(fromRender).toEqual([
      0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9,
    ]);
    expect(h.renderOnceCalls.n).toBe(10);
    h.dispose();
  });
});

describe("renderFrames restores the main camera (ac-009)", () => {
  it("restores activeCamera after normal completion", async () => {
    const h = makeHarness();
    await h.animator.renderFrames(
      { duration: 0.5, fps: 4 },
      async () => "data:image/png;base64,xxx",
    );
    expect(h.scene.activeCamera).toBe(h.mainCamera);
    h.dispose();
  });

  it("restores activeCamera even when a frame capture throws", async () => {
    const h = makeHarness();
    await expect(
      h.animator.renderFrames({ duration: 0.5, fps: 4 }, async () => {
        throw new Error("capture boom");
      }),
    ).rejects.toThrow(/boom/);
    expect(h.scene.activeCamera).toBe(h.mainCamera);
    h.dispose();
  });
});
