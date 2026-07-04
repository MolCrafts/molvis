import {
  defaultMolvisConfig,
  type Molvis,
  type MolvisConfig,
  type MolvisSetting,
  mountMolvis,
} from "@molvis/core";
import type React from "react";
import { useEffect, useRef } from "react";
import { useBondMappingPicker } from "@/components/bond-column-mapping-dialog";
import {
  loadFileSmart,
  useFormatPicker,
} from "@/components/format-picker-dialog";

interface MolvisWrapperProps {
  onMount?: (app: Molvis) => void;
}

type RuntimeInitPayload = {
  config?: unknown;
  settings?: unknown;
};

declare global {
  interface Window {
    __MOLVIS_VSCODE_INIT__?: RuntimeInitPayload;
  }
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function hslToRgb01(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (h % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  if (hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = l - c / 2;
  return [r + m, g + m, b + m];
}

function readCanvasColor(): [number, number, number] {
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue("--canvas")
    .trim();
  const match = raw.match(
    /^(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)%\s+(-?\d+(?:\.\d+)?)%$/,
  );
  if (!match) return [0, 0, 0];
  const h = Number.parseFloat(match[1]);
  const s = Number.parseFloat(match[2]) / 100;
  const l = Number.parseFloat(match[3]) / 100;
  return hslToRgb01(h, s, l);
}

function applyMolvisSettings(
  app: Molvis,
  settings: Partial<MolvisSetting>,
): void {
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
    app.settings.setCameraMaxRadius(settings.cameraMaxRadius);
  }
  if (settings.grid && typeof settings.grid === "object") {
    app.settings.setGrid(
      settings.grid as Parameters<typeof app.settings.setGrid>[0],
    );
  }
  if (settings.graphics && typeof settings.graphics === "object") {
    app.settings.setGraphics(
      settings.graphics as Parameters<typeof app.settings.setGraphics>[0],
    );
  }
}

/**
 * Mounts a MolVis core instance into a full-size container and handles cleanup.
 */
const MolvisWrapper: React.FC<MolvisWrapperProps> = ({ onMount }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const molvisRef = useRef<Molvis | null>(null);
  const pickFormat = useFormatPicker();
  const pickFormatRef = useRef(pickFormat);
  pickFormatRef.current = pickFormat;
  const pickBondMapping = useBondMappingPicker();
  const pickBondMappingRef = useRef(pickBondMapping);
  pickBondMappingRef.current = pickBondMapping;

  useEffect(() => {
    if (!containerRef.current) return;

    const baseConfig: MolvisConfig = {
      showUI: true,
      useRightHandedSystem: true,
      ui: {
        showModePanel: false,
        showViewPanel: true,
        showInfoPanel: true,
        showPerfPanel: true,
        showTrajPanel: false,
        showContextMenu: true,
      },
    };
    const runtimeConfig = asObject(window.__MOLVIS_VSCODE_INIT__?.config);
    const config = defaultMolvisConfig({
      ...baseConfig,
      ...(runtimeConfig as Partial<MolvisConfig>),
    });

    const baseSettings: Partial<MolvisSetting> = {
      grid: {
        enabled: false,
        size: 100,
        opacity: 0.5,
      },
      graphics: {
        hardwareScaling: 1.0,
        fxaa: true,
        dof: false,
      },
    };
    const runtimeSettings = asObject(window.__MOLVIS_VSCODE_INIT__?.settings) as
      | Partial<MolvisSetting>
      | undefined;
    const settings: Partial<MolvisSetting> = {
      ...baseSettings,
      ...runtimeSettings,
      grid: {
        ...baseSettings.grid,
        ...(runtimeSettings?.grid ?? {}),
      },
      graphics: {
        ...baseSettings.graphics,
        ...(runtimeSettings?.graphics ?? {}),
      },
    };

    const app = mountMolvis(containerRef.current, config, settings);
    molvisRef.current = app;

    const syncCanvasToTheme = () => {
      if (!molvisRef.current) return;
      const [r, g, b] = readCanvasColor();
      molvisRef.current.scene.clearColor.set(r, g, b, 1);
    };
    syncCanvasToTheme();

    const handleThemeChange = () => {
      syncCanvasToTheme();
    };
    window.addEventListener("molvis:theme-change", handleThemeChange);

    app.start().then(() => {
      if (onMount) {
        onMount(app);
      }
    });

    const resizeObserver = new ResizeObserver(() => {
      molvisRef.current?.resize();
    });
    resizeObserver.observe(containerRef.current);

    // Pause the render loop when the canvas is offscreen — critical for
    // notebook embeds where multiple cells coexist on the page; each
    // engine would otherwise render at 60fps even when scrolled away.
    const visibilityObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const m = molvisRef.current;
          if (!m) continue;
          if (entry.isIntersecting) m.start();
          else m.stop();
        }
      },
      { threshold: 0 },
    );
    visibilityObserver.observe(containerRef.current);

    const handleHostMessage = (
      event: MessageEvent<{
        type?: string;
        config?: unknown;
        settings?: unknown;
      }>,
    ) => {
      const payload = event.data;
      if (!payload || typeof payload !== "object") {
        return;
      }
      if (payload.type !== "init" && payload.type !== "applySettings") {
        return;
      }
      if (!molvisRef.current) {
        return;
      }

      const nextConfig = asObject(payload.config);
      if (nextConfig) {
        molvisRef.current.setConfig(nextConfig as Partial<MolvisConfig>);
      }

      const nextSettings = asObject(payload.settings) as
        | Partial<MolvisSetting>
        | undefined;
      if (nextSettings) {
        applyMolvisSettings(molvisRef.current, nextSettings);
      }
    };
    window.addEventListener("message", handleHostMessage);

    const container = containerRef.current;
    const handleDragOver = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
    };
    const handleDrop = async (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const file = e.dataTransfer?.files?.[0];
      const app = molvisRef.current;
      if (!file || !app) return;
      // "auto": app.addDataSource handles the empty-pipeline case (first DS
      // becomes the primary trajectory), an equal-shape file appends, and a
      // multi-frame trajectory dropped onto a single static structure with
      // bonds keeps the topology while the positions animate. Explicit
      // replacement stays a remove + add through the pipeline UI.
      // loadFileSmart owns the status-message emits and error handling
      // (streaming/eager routing, format prompt, bond-mapping prompt).
      await loadFileSmart(
        app,
        file,
        pickFormatRef.current,
        "auto",
        pickBondMappingRef.current,
      );
    };
    container.addEventListener("dragover", handleDragOver);
    container.addEventListener("drop", handleDrop);

    return () => {
      container.removeEventListener("dragover", handleDragOver);
      container.removeEventListener("drop", handleDrop);
      resizeObserver.disconnect();
      visibilityObserver.disconnect();
      window.removeEventListener("message", handleHostMessage);
      window.removeEventListener("molvis:theme-change", handleThemeChange);
      if (molvisRef.current) {
        molvisRef.current.destroy();
        molvisRef.current = null;
      }
    };
  }, [onMount]);

  return (
    <div
      ref={containerRef}
      style={{ position: "absolute", inset: 0, overflow: "hidden" }}
    />
  );
};

export default MolvisWrapper;
