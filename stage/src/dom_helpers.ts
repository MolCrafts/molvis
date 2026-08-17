import type { MolvisConfig } from "./config";
import {
  MolvisButton,
  MolvisFolder,
  MolvisSeparator,
  MolvisSlider,
} from "./ui/components";
import { MolvisContextMenu } from "./ui/menus/context_menu";

export interface MolvisDOMElements {
  root: HTMLElement;
  canvas: HTMLCanvasElement;
  uiOverlay: HTMLElement;
}

export function registerWebComponents(): void {
  const defs: [string, CustomElementConstructor][] = [
    ["molvis-context-menu", MolvisContextMenu],
    ["molvis-button", MolvisButton],
    ["molvis-separator", MolvisSeparator],
    ["molvis-folder", MolvisFolder],
    ["molvis-slider", MolvisSlider],
  ];
  for (const [name, ctor] of defs) {
    if (!customElements.get(name)) {
      customElements.define(name, ctor);
    }
  }
}

/**
 * Ensure the host element is a containing block for absolute UI overlays.
 * Without this, panels (e.g. view "Persp") escape to a higher ancestor when
 * the host is still ``position: static`` — the classic embed footgun.
 */
export function ensureMountContainingBlock(container: HTMLElement): void {
  const style = getComputedStyle(container);
  if (style.position === "static") {
    container.style.position = "relative";
  }
  if (style.overflow === "visible") {
    // Clip/contain absolute chrome so it never paints over the host chrome.
    container.style.overflow = "hidden";
  }
  // Zero-size hosts make canvas + overlay collapse; give a minimal box so
  // first layout still produces a usable surface (ResizeObserver will grow it).
  if (container.clientWidth === 0 && container.clientHeight === 0) {
    if (!container.style.minHeight) container.style.minHeight = "240px";
    if (!container.style.width && !container.style.minWidth) {
      container.style.minWidth = "100%";
    }
  }
}

export function createMolvisDOM(
  container: HTMLElement,
  config: MolvisConfig,
): MolvisDOMElements {
  ensureMountContainingBlock(container);

  // Root element
  const root = document.createElement("div");
  root.className = "molvis-root";
  root.style.position = "relative";
  root.style.width = "100%";
  root.style.height = "100%";
  root.style.overflow = "hidden";
  root.style.margin = "0";
  root.style.padding = "0";

  // Canvas
  const canvas = document.createElement("canvas");
  canvas.className = "molvis-canvas";
  canvas.style.position = "absolute";
  canvas.style.top = "0";
  canvas.style.left = "0";
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.style.display = "block";
  canvas.style.outline = "none";
  canvas.style.touchAction = "none";

  canvas.addEventListener(
    "wheel",
    (evt) => {
      evt.preventDefault();
    },
    { passive: false },
  );

  const width = container.clientWidth || 800;
  const height = container.clientHeight || 600;
  canvas.width = Math.floor(width);
  canvas.height = Math.floor(height);

  // UI overlay
  const uiOverlay = document.createElement("div");
  uiOverlay.className = "molvis-ui-overlay";
  uiOverlay.style.position = "absolute";
  uiOverlay.style.top = "0";
  uiOverlay.style.left = "0";
  uiOverlay.style.width = "100%";
  uiOverlay.style.height = "100%";
  uiOverlay.style.pointerEvents = "none";

  if (config.showUI === false) {
    uiOverlay.style.display = "none";
  }

  // Assemble
  root.appendChild(canvas);
  root.appendChild(uiOverlay);
  container.appendChild(root);

  return { root, canvas, uiOverlay };
}
