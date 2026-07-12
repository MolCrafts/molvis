import type { MolvisApp } from "./app";

export const MOLVIS_VIEWER_CONTROLS = [
  "view",
  "trajectory",
  "mode",
  "info",
  "performance",
  "context-menu",
] as const;

export const MOLVIS_VIEWER_MODES = [
  "view",
  "select",
  "edit",
  "manipulate",
  "measure",
] as const;

export const MOLVIS_VIEWER_REPRESENTATIONS = [
  "ball-and-stick",
  "spacefill",
  "stick",
] as const;

export type MolvisViewerControl = (typeof MOLVIS_VIEWER_CONTROLS)[number];
export type MolvisViewerMode = (typeof MOLVIS_VIEWER_MODES)[number];
export type MolvisViewerRepresentation =
  (typeof MOLVIS_VIEWER_REPRESENTATIONS)[number];

export interface MolvisViewerSource {
  src?: string;
  content?: string;
  format?: string;
}

export interface MolvisViewerOptions extends MolvisViewerSource {
  controls: MolvisViewerControl[];
  modes: MolvisViewerMode[];
  mode: MolvisViewerMode;
  representation: MolvisViewerRepresentation;
  background?: string;
  width: string;
  height: string;
}

export interface MountedMolvisViewer {
  readonly app: MolvisApp;
  start(): void;
  stop(): void;
  resize(): void;
  dispose(): void;
}

const DEFAULT_CONTROLS: MolvisViewerControl[] = ["view", "trajectory"];
const DEFAULT_MODES: MolvisViewerMode[] = ["view"];
const OBSERVED_ATTRIBUTES = [
  "src",
  "format",
  "controls",
  "modes",
  "mode",
  "representation",
  "background",
  "width",
  "height",
] as const;

function parseTokens<T extends string>(
  value: string | null,
  allowed: readonly T[],
  fallback: readonly T[],
  attribute: string,
): T[] {
  if (value === null || value.trim() === "") return [...fallback];
  const tokens = Array.from(new Set(value.trim().split(/\s+/)));
  const invalid = tokens.filter((token) => !allowed.includes(token as T));
  if (invalid.length > 0) {
    throw new Error(
      `Invalid ${attribute} value(s): ${invalid.join(", ")}. Expected: ${allowed.join(", ")}.`,
    );
  }
  return tokens as T[];
}

function directSourceTemplate(element: Element): HTMLTemplateElement | null {
  for (const child of element.children) {
    if (
      child instanceof HTMLTemplateElement &&
      child.hasAttribute("data-molvis-source")
    ) {
      return child;
    }
  }
  return null;
}

/** Parse and validate the author-facing attributes and inline source. */
export function parseMolvisViewer(element: Element): MolvisViewerOptions {
  const src = element.getAttribute("src")?.trim() || undefined;
  const template = directSourceTemplate(element);
  const content = template?.content.textContent ?? undefined;
  if (src && template) {
    throw new Error(
      "molvis-viewer accepts either src or inline source, not both.",
    );
  }
  if (!src && !template) {
    throw new Error(
      "molvis-viewer requires src or a <template data-molvis-source> child.",
    );
  }

  const format = element.getAttribute("format")?.trim() || undefined;
  if (template && !format) {
    throw new Error("Inline molvis-viewer source requires a format attribute.");
  }

  const controls = parseTokens(
    element.getAttribute("controls"),
    MOLVIS_VIEWER_CONTROLS,
    DEFAULT_CONTROLS,
    "controls",
  );
  const modes = parseTokens(
    element.getAttribute("modes"),
    MOLVIS_VIEWER_MODES,
    DEFAULT_MODES,
    "modes",
  );
  if (!modes.includes("view")) {
    throw new Error('molvis-viewer modes must include "view".');
  }

  const mode = (element.getAttribute("mode")?.trim() ||
    "view") as MolvisViewerMode;
  if (!MOLVIS_VIEWER_MODES.includes(mode)) {
    throw new Error(`Invalid mode: ${mode}.`);
  }
  if (!modes.includes(mode)) {
    throw new Error(`Initial mode "${mode}" is not included in modes.`);
  }

  const representation = (element.getAttribute("representation")?.trim() ||
    "ball-and-stick") as MolvisViewerRepresentation;
  if (!MOLVIS_VIEWER_REPRESENTATIONS.includes(representation)) {
    throw new Error(`Invalid representation: ${representation}.`);
  }

  return {
    src,
    content,
    format,
    controls,
    modes,
    mode,
    representation,
    background: element.getAttribute("background")?.trim() || undefined,
    width: element.getAttribute("width")?.trim() || "100%",
    height: element.getAttribute("height")?.trim() || "420px",
  };
}

/** Browser-native MolVis molecular viewer. Registration is explicit. */
export class MolvisViewerElement extends HTMLElement {
  static get observedAttributes(): readonly string[] {
    return OBSERVED_ATTRIBUTES;
  }

  private mounted: MountedMolvisViewer | null = null;
  private abortController: AbortController | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private visibilityObserver: IntersectionObserver | null = null;
  private generation = 0;

  get app(): MolvisApp | null {
    return this.mounted?.app ?? null;
  }

  connectedCallback(): void {
    void this.reload();
  }

  disconnectedCallback(): void {
    this.teardown();
  }

  attributeChangedCallback(
    name: string,
    oldValue: string | null,
    newValue: string | null,
  ): void {
    if (oldValue === newValue || !this.isConnected) return;
    if (name === "width" || name === "height") {
      this.applyDimensions();
      this.mounted?.resize();
      return;
    }
    if (name === "mode" && this.mounted) {
      const mode = newValue?.trim() || "view";
      this.mounted.app.setMode(mode);
      return;
    }
    if (name === "representation" && this.mounted) {
      this.mounted.app.setRepresentation(
        representationName(newValue?.trim() || "ball-and-stick"),
      );
      return;
    }
    if (name === "background" && this.mounted && newValue) {
      this.mounted.app.setBackgroundColor(newValue);
      return;
    }
    void this.reload();
  }

  async reload(): Promise<void> {
    const generation = ++this.generation;
    this.teardownMounted();
    this.applyDimensions();

    let options: MolvisViewerOptions;
    try {
      options = parseMolvisViewer(this);
    } catch (error) {
      this.showError(error);
      return;
    }

    const root = document.createElement("div");
    root.dataset.molvisViewerRoot = "";
    root.style.cssText = "position:absolute;inset:0;overflow:hidden;";
    this.appendChild(root);
    this.dataset.state = "loading";

    const abortController = new AbortController();
    this.abortController = abortController;
    try {
      const { mountMolvisViewer } = await import("./element_runtime");
      if (generation !== this.generation || !this.isConnected) return;
      const mounted = await mountMolvisViewer(
        root,
        options,
        abortController.signal,
      );
      if (generation !== this.generation || !this.isConnected) {
        mounted.dispose();
        return;
      }
      this.mounted = mounted;
      this.observeMountedViewer();
      this.dataset.state = "ready";
      this.dispatchEvent(
        new CustomEvent("molvis:ready", {
          detail: { app: mounted.app },
          bubbles: true,
          composed: true,
        }),
      );
    } catch (error) {
      if (generation !== this.generation || abortController.signal.aborted) {
        return;
      }
      this.showError(error);
    }
  }

  private applyDimensions(): void {
    const width = this.getAttribute("width")?.trim();
    const height = this.getAttribute("height")?.trim();
    this.style.width = width || "";
    this.style.height = height || "";
  }

  private observeMountedViewer(): void {
    if (!this.mounted) return;
    this.resizeObserver = new ResizeObserver(() => this.mounted?.resize());
    this.resizeObserver.observe(this);
    this.visibilityObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) this.mounted?.start();
        else this.mounted?.stop();
      }
    });
    this.visibilityObserver.observe(this);
  }

  private showError(value: unknown): void {
    this.teardownMounted();
    const error = value instanceof Error ? value : new Error(String(value));
    const message = document.createElement("div");
    message.dataset.molvisViewerError = "";
    message.setAttribute("role", "alert");
    message.style.cssText =
      "box-sizing:border-box;padding:1rem;color:#b42318;background:#fef3f2;font:14px/1.5 system-ui,sans-serif;";
    message.textContent = error.message;
    this.appendChild(message);
    this.dataset.state = "error";
    this.dispatchEvent(
      new CustomEvent("molvis:error", {
        detail: { error },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private teardownMounted(): void {
    this.abortController?.abort();
    this.abortController = null;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.visibilityObserver?.disconnect();
    this.visibilityObserver = null;
    this.mounted?.dispose();
    this.mounted = null;
    for (const child of Array.from(this.children)) {
      if (child.hasAttribute("data-molvis-viewer-root")) child.remove();
      if (child.hasAttribute("data-molvis-viewer-error")) child.remove();
    }
  }

  private teardown(): void {
    ++this.generation;
    this.teardownMounted();
    delete this.dataset.state;
  }
}

function ensureDefaultStyle(tag: string): void {
  const id = `molvis-viewer-style-${tag}`;
  if (document.getElementById(id)) return;
  const style = document.createElement("style");
  style.id = id;
  style.textContent = `:where(${tag}){display:block;position:relative;width:100%;height:420px;overflow:hidden;}`;
  document.head.appendChild(style);
}

/** Define the viewer once without making the main package import side-effecting. */
export function defineMolvisViewer(tag = "molvis-viewer"): void {
  if (!customElements.get(tag)) customElements.define(tag, MolvisViewerElement);
  ensureDefaultStyle(tag);
}

export function representationName(value: string): string {
  switch (value) {
    case "ball-and-stick":
      return "Ball and Stick";
    case "spacefill":
      return "Spacefill";
    case "stick":
      return "Stick";
    default:
      throw new Error(`Invalid representation: ${value}.`);
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "molvis-viewer": MolvisViewerElement;
  }
}
