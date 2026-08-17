/**
 * Apply host-injected config + settings onto a running stage app.
 * Typed against a narrow surface so unit tests need no stage import.
 */

/** Subset of stage `Molvis` used by config/settings application. */
export interface ConfigSettingsTarget {
  setConfig(config: Record<string, unknown>): void;
  settings: {
    setShowFps(value: boolean): void;
    setCameraPanSpeed(value: number): void;
    setCameraRotateSpeed(value: number): void;
    setCameraZoomSpeed(value: number): void;
    setCameraInertia(value: number): void;
    setCameraPanInertia(value: number): void;
    setCameraMinRadius(value: number): void;
    setCameraMaxRadius(value: number | null): void;
    setGrid(value: unknown): void;
    setGraphics(value: unknown): void;
    setLighting(value: unknown): void;
  };
}

export function applyConfigAndSettings(
  app: ConfigSettingsTarget,
  config: unknown,
  settings: unknown,
): void {
  if (config && typeof config === "object") {
    app.setConfig(config as Record<string, unknown>);
  }
  if (settings && typeof settings === "object") {
    applyMolvisSettings(app, settings as Record<string, unknown>);
  }
}

export function applyMolvisSettings(
  app: ConfigSettingsTarget,
  settings: Record<string, unknown>,
): void {
  if (typeof settings.showFps === "boolean") {
    app.settings.setShowFps(settings.showFps);
  }
  if (typeof settings.cameraPanSpeed === "number") {
    app.settings.setCameraPanSpeed(settings.cameraPanSpeed);
  }
  if (typeof settings.cameraRotateSpeed === "number") {
    app.settings.setCameraRotateSpeed(settings.cameraRotateSpeed);
  }
  if (typeof settings.cameraZoomSpeed === "number") {
    app.settings.setCameraZoomSpeed(settings.cameraZoomSpeed);
  }
  if (typeof settings.cameraInertia === "number") {
    app.settings.setCameraInertia(settings.cameraInertia);
  }
  if (typeof settings.cameraPanInertia === "number") {
    app.settings.setCameraPanInertia(settings.cameraPanInertia);
  }
  if (typeof settings.cameraMinRadius === "number") {
    app.settings.setCameraMinRadius(settings.cameraMinRadius);
  }
  if (
    settings.cameraMaxRadius === null ||
    typeof settings.cameraMaxRadius === "number"
  ) {
    app.settings.setCameraMaxRadius(settings.cameraMaxRadius as number | null);
  }
  if (settings.grid && typeof settings.grid === "object") {
    app.settings.setGrid(settings.grid);
  }
  if (settings.graphics && typeof settings.graphics === "object") {
    app.settings.setGraphics(settings.graphics);
  }
  if (settings.lighting && typeof settings.lighting === "object") {
    app.settings.setLighting(settings.lighting);
  }
}
