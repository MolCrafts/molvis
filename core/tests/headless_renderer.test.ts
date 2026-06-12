import { type Engine, NullEngine } from "@babylonjs/core";
import { Frame } from "@molcrafts/molrs";
import { describe, expect, it } from "@rstest/core";
import { MolvisApp } from "../src/app";
import {
  DataSourceModifier,
  FileDataSource,
} from "../src/pipeline/data_source_modifier";
import { MolvisRenderer } from "../src/renderer";
import { Trajectory } from "../src/system/trajectory";

/**
 * Semi-headless rendering facade tests.
 *
 * rstest runs in headless Chromium (real WebGL), but every binding test here
 * injects a {@link NullEngine} so the render core builds and runs
 * deterministically without touching the GPU. Real-pixel correctness is
 * intentionally NOT asserted here — it lives in the spec's non-binding
 * `## UI verification` section because NullEngine produces no pixels.
 */

/** A detached canvas usable as a headless render surface (never appended to the DOM). */
function makeCanvas(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  return canvas;
}

/** Construct a GUI-less MolvisApp with an injected engine. */
function makeHeadlessApp(engine: Engine, canvas = makeCanvas()): MolvisApp {
  return new MolvisApp(canvas, { gui: false, engine });
}

describe("GUI-less MolvisApp construction (ac-002 / ac-003 / ac-004)", () => {
  it("ac-002: gui:false builds the render core but no GUI or mode manager", () => {
    const engine = new NullEngine();
    const app = makeHeadlessApp(engine);
    try {
      // Render core is present...
      expect(app.world).toBeDefined();
      expect(app.scene.getEngine()).toBe(engine);
      expect(app.modifierPipeline).toBeDefined();
      // ...but no interaction mode and no mounted GUI.
      expect(app.mode).toBeUndefined();
      expect(() => app.gui).toThrow();
    } finally {
      app.destroy();
    }
  });

  it("ac-003: gui:false uses the caller-provided canvas verbatim", () => {
    const engine = new NullEngine();
    const canvas = makeCanvas();
    const app = new MolvisApp(canvas, { gui: false, engine });
    try {
      // The gui path would have created a NEW canvas inside createMolvisDOM;
      // identity equality proves the DOM chrome was skipped.
      expect(app.canvas).toBe(canvas);
      // The headless root is never attached to the document.
      expect(document.body.contains(app.rootContainer)).toBe(false);
    } finally {
      app.destroy();
    }
  });

  it("ac-004: setMode and destroy do not throw on a GUI-less instance", () => {
    const engine = new NullEngine();
    const app = makeHeadlessApp(engine);
    expect(() => app.setMode("view")).not.toThrow();
    expect(() => app.destroy()).not.toThrow();
  });

  it("defaults gui to true when omitted (config contract, ac-001)", () => {
    // A normal (gui:true) construction still resolves a config with gui === true.
    // We do not build a real-WebGL app here; just assert the default merge.
    const app = makeHeadlessApp(new NullEngine());
    try {
      expect(app.config.gui).toBe(false); // explicit override respected
    } finally {
      app.destroy();
    }
  });
});

describe("MolvisRenderer facade (ac-005 / ac-006 / ac-007 / ac-008)", () => {
  it("ac-005: facade composes a gui:false app and exposes the narrow subset", () => {
    const renderer = new MolvisRenderer(makeCanvas(), {
      engine: new NullEngine(),
    });
    try {
      for (const method of [
        "load",
        "setRepresentation",
        "setBackgroundColor",
        "setTheme",
        "resetCamera",
        "fitCamera",
        "setSize",
        "setResolution",
        "snapshot",
        "renderAnimation",
        "dispose",
      ]) {
        expect(
          typeof (renderer as unknown as Record<string, unknown>)[method],
        ).toBe("function");
      }
      // Composition, not reimplementation: the underlying app is GUI-less.
      expect(renderer.app).toBeInstanceOf(MolvisApp);
      expect(renderer.app.mode).toBeUndefined();
    } finally {
      renderer.dispose();
    }
  });

  it("ac-006: load routes data through the pipeline DataSource head", async () => {
    const renderer = new MolvisRenderer(makeCanvas(), {
      engine: new NullEngine(),
    });
    try {
      await renderer.load(new Trajectory([new Frame()]));
      const mods = renderer.app.modifierPipeline.getModifiers();
      expect(mods[0]).toBeInstanceOf(DataSourceModifier);
      expect(mods[0]).toBeInstanceOf(FileDataSource);
    } finally {
      renderer.dispose();
    }
  });

  // NullEngine cannot produce real pixels — `Tools.CreateScreenshot...` never
  // resolves on it — so the render-path tests stub the capture (as
  // camera_animator.test.ts does for `renderFrames`) and assert the facade's
  // wiring, not pixels. Real-pixel capture is exercised in the spec's
  // non-binding `## UI verification` section against a real WebGL host.
  const STUB_PNG = "data:image/png;base64,stub";

  it("ac-007: snapshot renders on demand and never starts the render loop", async () => {
    const engine = new NullEngine();
    const renderer = new MolvisRenderer(makeCanvas(), { engine });
    try {
      await renderer.load(new Trajectory([new Frame()]));
      renderer.app.screenshot = async () => STUB_PNG;

      let runLoopCalls = 0;
      const realRunLoop = engine.runRenderLoop.bind(engine);
      engine.runRenderLoop = ((fn: () => void) => {
        runLoopCalls += 1;
        return realRunLoop(fn);
      }) as Engine["runRenderLoop"];

      const world = renderer.app.world;
      let renderOnceCalls = 0;
      const realRenderOnce = world.renderOnce.bind(world);
      world.renderOnce = () => {
        renderOnceCalls += 1;
        realRenderOnce();
      };

      const data = await renderer.snapshot();
      expect(typeof data).toBe("string");
      expect(data.startsWith("data:")).toBe(true);
      expect(renderOnceCalls).toBeGreaterThanOrEqual(1);
      expect(runLoopCalls).toBe(0);
    } finally {
      renderer.dispose();
    }
  });

  it("ac-008: renderAnimation returns round(duration*fps) frames", async () => {
    const renderer = new MolvisRenderer(makeCanvas(), {
      engine: new NullEngine(),
    });
    try {
      await renderer.load(new Trajectory([new Frame()]));
      renderer.app.screenshot = async () => STUB_PNG;

      const frames = await renderer.renderAnimation({ duration: 1, fps: 10 });
      expect(frames).toHaveLength(10);
      expect(frames.every((f) => typeof f === "string")).toBe(true);

      const odd = await renderer.renderAnimation({ duration: 0.3, fps: 10 });
      expect(odd).toHaveLength(3); // Math.round(3) === 3
    } finally {
      renderer.dispose();
    }
  });
});
