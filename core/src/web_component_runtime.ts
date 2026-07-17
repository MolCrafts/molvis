import { Engine } from "@babylonjs/core";
import { MolvisApp } from "./app";
import { findRepresentation } from "./artist/representation";
import type { MolvisConfig } from "./config";
import type {
  MolvisStyleGalleryOptions,
  MolvisViewerOptions,
  MountedMolvisStyleGallery,
  MountedMolvisViewer,
} from "./element";
import { loadFileContent } from "./io";
import {
  describeFormat,
  FILE_FORMAT_REGISTRY,
  type FileFormat,
  inferFormatFromFilename,
} from "./io/formats";
import type { ModeType } from "./mode";

/** Gallery cameras sit 30° closer to +Z than the ordinary isometric view. */
const GALLERY_CAMERA_Z_OFFSET = Math.PI / 6;

/** Advance one gallery turntable camera by a render-frame delta. */
export function advanceGalleryCameraRotation(
  camera: { alpha: number },
  deltaMilliseconds: number,
  rotationSpeed: number,
): void {
  if (rotationSpeed <= 0) return;
  camera.alpha += (deltaMilliseconds / 1000) * rotationSpeed;
}

function resolveFormat(
  value: string | undefined,
  filename: string,
): FileFormat {
  const candidate = value || inferFormatFromFilename(filename);
  if (!candidate) {
    throw new Error(
      `Unable to infer a molecular format from "${filename}"; add format explicitly.`,
    );
  }
  if (!FILE_FORMAT_REGISTRY.some((item) => item.format === candidate)) {
    throw new Error(`Unsupported molecular format: ${candidate}.`);
  }
  return candidate as FileFormat;
}

function filenameFromUrl(src: string): string {
  const url = new URL(src, document.baseURI);
  const filename = decodeURIComponent(url.pathname.split("/").pop() || "");
  return filename || "remote-structure";
}

interface ResolvedSource {
  content: string | Uint8Array;
  filename: string;
  format: FileFormat;
}

async function resolveSource(
  options: Pick<MolvisViewerOptions, "src" | "content" | "format">,
  signal: AbortSignal,
): Promise<ResolvedSource> {
  if (options.src) {
    const filename = filenameFromUrl(options.src);
    const format = resolveFormat(options.format, filename);
    const response = await fetch(new URL(options.src, document.baseURI), {
      signal,
    });
    if (!response.ok) {
      throw new Error(
        `Failed to load ${options.src}: HTTP ${response.status} ${response.statusText}.`,
      );
    }
    const descriptor = describeFormat(format);
    const content =
      descriptor.payload === "binary"
        ? new Uint8Array(await response.arrayBuffer())
        : await response.text();
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    return { content, filename, format };
  }

  const format = resolveFormat(options.format, `inline.${options.format}`);
  return {
    content: options.content ?? "",
    filename: `inline.${describeFormat(format).extensions[0]}`,
    format,
  };
}

async function loadResolvedSource(
  app: MolvisApp,
  source: ResolvedSource,
): Promise<void> {
  const content =
    typeof source.content === "string"
      ? source.content
      : new Uint8Array(source.content);
  await loadFileContent(app, content, source.filename, source.format);
}

/** Heavy runtime loaded only after a MolVis Web Component connects. */
export async function mountMolvisViewer(
  root: HTMLElement,
  options: MolvisViewerOptions,
  signal: AbortSignal,
): Promise<MountedMolvisViewer> {
  const controls = new Set(options.controls);
  const config: MolvisConfig = {
    showUI: true,
    enabledModes: options.modes as ModeType[],
    ui: {
      showViewPanel: controls.has("view"),
      showTrajPanel: controls.has("trajectory"),
      showModePanel: controls.has("mode"),
      showInfoPanel: controls.has("info"),
      showPerfPanel: controls.has("performance"),
      showContextMenu: controls.has("context-menu"),
    },
  };
  const app = new MolvisApp(root, config, { grid: { enabled: false } });
  try {
    const source = await resolveSource(options, signal);
    await loadResolvedSource(app, source);
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    await app.setRepresentation(options.representation);
    if (options.background) app.setBackgroundColor(options.background);
    await app.start();
    app.setMode(options.mode);
  } catch (error) {
    app.destroy();
    throw error;
  }

  let disposed = false;
  return {
    app,
    start: () => {
      if (!disposed) void app.start();
    },
    stop: () => {
      if (!disposed) app.stop();
    },
    resize: () => {
      if (!disposed) app.resize();
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      app.destroy();
    },
  };
}

/**
 * Mount several independent MolVis scenes onto BabylonJS engine views.
 * The visible canvases are 2D copy targets; one hidden WebGL canvas owns the
 * only engine/context, so the gallery stays comfortably below browser context
 * limits even when every representation is shown.
 */
export async function mountMolvisStyleGallery(
  root: HTMLElement,
  options: MolvisStyleGalleryOptions,
  signal: AbortSignal,
): Promise<MountedMolvisStyleGallery> {
  const source = await resolveSource(options, signal);
  if (signal.aborted) throw new DOMException("Aborted", "AbortError");

  const masterCanvas = document.createElement("canvas");
  masterCanvas.dataset.molvisGalleryEngineCanvas = "";
  masterCanvas.width = 1;
  masterCanvas.height = 1;
  masterCanvas.setAttribute("aria-hidden", "true");
  masterCanvas.style.cssText =
    "position:fixed;left:-2px;top:-2px;width:1px;height:1px;opacity:0;pointer-events:none;";
  root.appendChild(masterCanvas);

  const engine = new Engine(
    masterCanvas,
    true,
    {
      alpha: false,
      preserveDrawingBuffer: false,
      stencil: true,
    },
    false,
  );
  const apps: MolvisApp[] = [];
  const canvases: HTMLCanvasElement[] = [];
  const appByCanvas = new Map<HTMLCanvasElement, MolvisApp>();
  const views: Array<{ target: HTMLCanvasElement; enabled: boolean }> = [];
  let cardObserver: IntersectionObserver | null = null;
  let disposed = false;
  let running = false;
  const render = () => {
    const target = engine.activeView?.target;
    if (!target) return;
    const app = appByCanvas.get(target);
    if (!app) return;
    advanceGalleryCameraRotation(
      app.world.camera,
      engine.getDeltaTime(),
      options.rotationSpeed,
    );
    app.world.renderOnce();
  };

  const stop = () => {
    if (!running) return;
    running = false;
    engine.stopRenderLoop(render);
  };

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    stop();
    cardObserver?.disconnect();
    cardObserver = null;
    for (const canvas of canvases) engine.unRegisterView(canvas);
    for (const app of apps) app.destroy();
    engine.dispose();
  };

  try {
    for (const representationId of options.representations) {
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      const representation = findRepresentation(representationId);
      const card = document.createElement("figure");
      card.className = "molvis-style-gallery__card";

      const preview = document.createElement("div");
      preview.className = "molvis-style-gallery__preview";
      preview.addEventListener("contextmenu", (event) =>
        event.preventDefault(),
      );
      const canvas = document.createElement("canvas");
      canvas.className = "molvis-style-gallery__canvas";
      canvas.setAttribute("role", "img");
      canvas.setAttribute(
        "aria-label",
        `Aspirin rendered as ${representation.name}`,
      );
      preview.appendChild(canvas);

      const caption = document.createElement("figcaption");
      caption.className = "molvis-style-gallery__caption";
      const name = document.createElement("strong");
      name.textContent = representation.name;
      const id = document.createElement("code");
      id.textContent = representation.id;
      caption.append(name, id);
      card.append(preview, caption);
      root.appendChild(card);

      const app = new MolvisApp(
        canvas,
        {
          gui: false,
          engine,
          engineOwnership: "external",
          interactive: false,
          decorations: false,
          canvas: { preserveDrawingBuffer: false },
        },
        { grid: { enabled: false } },
      );
      apps.push(app);
      canvases.push(canvas);
      appByCanvas.set(canvas, app);
      views.push(engine.registerView(canvas, app.world.camera, true));

      await loadResolvedSource(app, source);
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      await app.setRepresentation(representationId);
      if (options.background) app.setBackgroundColor(options.background);
      app.world.resetCamera({ viewDirection: "iso" });
      // ArcRotateCamera.beta is the polar angle measured down from +Z, so
      // subtracting 30° raises the gallery view toward +Z. Keep this local to
      // the gallery; ordinary viewers retain MolVis's standard isometric pose.
      app.world.camera.beta = Math.max(
        0.01,
        app.world.camera.beta - GALLERY_CAMERA_Z_OFFSET,
      );
    }

    cardObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const canvas = entry.target.querySelector("canvas");
        const view = views.find((candidate) => candidate.target === canvas);
        if (view) view.enabled = entry.isIntersecting;
      }
    });
    for (const card of root.querySelectorAll(".molvis-style-gallery__card")) {
      cardObserver.observe(card);
    }
  } catch (error) {
    dispose();
    throw error;
  }

  return {
    engine,
    apps,
    start: () => {
      if (disposed || running) return;
      running = true;
      engine.runRenderLoop(render);
    },
    stop,
    dispose,
  };
}
