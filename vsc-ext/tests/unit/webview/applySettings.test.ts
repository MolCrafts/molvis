import * as assert from "assert";
import { applyMolvisSettings } from "../../../src/webview/applySettings";

/** Minimal app.settings mock for unit isolation from stage. */
function makeSettingsMock() {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const settings = {
    setShowFps: (...args: unknown[]) => {
      calls.push({ method: "setShowFps", args });
    },
    setCameraPanSpeed: (...args: unknown[]) => {
      calls.push({ method: "setCameraPanSpeed", args });
    },
    setCameraRotateSpeed: (...args: unknown[]) => {
      calls.push({ method: "setCameraRotateSpeed", args });
    },
    setCameraZoomSpeed: (...args: unknown[]) => {
      calls.push({ method: "setCameraZoomSpeed", args });
    },
    setCameraInertia: (...args: unknown[]) => {
      calls.push({ method: "setCameraInertia", args });
    },
    setCameraPanInertia: (...args: unknown[]) => {
      calls.push({ method: "setCameraPanInertia", args });
    },
    setCameraMinRadius: (...args: unknown[]) => {
      calls.push({ method: "setCameraMinRadius", args });
    },
    setCameraMaxRadius: (...args: unknown[]) => {
      calls.push({ method: "setCameraMaxRadius", args });
    },
    setGrid: (...args: unknown[]) => {
      calls.push({ method: "setGrid", args });
    },
    setGraphics: (...args: unknown[]) => {
      calls.push({ method: "setGraphics", args });
    },
    setLighting: (...args: unknown[]) => {
      calls.push({ method: "setLighting", args });
    },
  };
  return {
    calls,
    app: {
      setConfig: () => {},
      settings,
    },
  };
}

suite("webview/applySettings", () => {
  test("applyMolvisSettings forwards known camera and grid fields", () => {
    const { app, calls } = makeSettingsMock();
    applyMolvisSettings(app, {
      showFps: false,
      cameraRotateSpeed: 1.5,
      cameraZoomSpeed: 2,
      grid: { enabled: true, size: 50, opacity: 0.2 },
    });
    assert.ok(
      calls.some((c) => c.method === "setShowFps" && c.args[0] === false),
    );
    assert.ok(
      calls.some(
        (c) => c.method === "setCameraRotateSpeed" && c.args[0] === 1.5,
      ),
    );
    assert.ok(
      calls.some((c) => c.method === "setCameraZoomSpeed" && c.args[0] === 2),
    );
    assert.ok(calls.some((c) => c.method === "setGrid"));
  });

  test("applyMolvisSettings ignores empty partial without throwing", () => {
    const { app, calls } = makeSettingsMock();
    applyMolvisSettings(app, {});
    assert.strictEqual(calls.length, 0);
  });
});
