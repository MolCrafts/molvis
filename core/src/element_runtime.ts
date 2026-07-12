import { MolvisApp } from "./app";
import type { MolvisConfig } from "./config";
import type { MolvisViewerOptions, MountedMolvisViewer } from "./element";
import { representationName } from "./element";
import { loadFileContent } from "./io";
import {
  describeFormat,
  FILE_FORMAT_REGISTRY,
  type FileFormat,
  inferFormatFromFilename,
} from "./io/formats";
import type { ModeType } from "./mode";

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

async function loadSource(
  app: MountedMolvisViewer["app"],
  options: MolvisViewerOptions,
  signal: AbortSignal,
): Promise<void> {
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
    await loadFileContent(app, content, filename, format);
    return;
  }

  const format = resolveFormat(options.format, `inline.${options.format}`);
  await loadFileContent(
    app,
    options.content ?? "",
    `inline.${describeFormat(format).extensions[0]}`,
    format,
  );
}

/** Heavy runtime loaded only after a molvis-viewer connects. */
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
    await loadSource(app, options, signal);
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    app.setRepresentation(representationName(options.representation));
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
