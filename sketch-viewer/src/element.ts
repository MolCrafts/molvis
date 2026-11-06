import { SketchComposer, type SketchMode } from "@molcrafts/molvis-sketch";
import { createSketchPreview, type SketchPreview } from "./preview";

function parseMode(value: string | null): SketchMode {
  if (value === null || value.trim() === "") return "readonly";
  const mode = value.trim();
  if (mode === "readonly" || mode === "edit") return mode;
  throw new Error(
    `<molvis-sketch> mode must be "readonly" or "edit", got "${value}"`,
  );
}

/**
 * Declarative 2D sketch host for documentation and static pages.
 *
 * Mounts {@link SketchComposer}. `mode` is `readonly` (the default: the
 * MolCrafts preview header from `@molcrafts/ui`, a board that cannot be drawn
 * on) or `edit` (the editor). `label` names what it shows. `gui="false"`
 * drops the header and leaves the canvas. The engine
 * API stays on
 * `@molcrafts/molvis-sketch`; this class is the custom-element wrapper.
 * CDN registration is the `@molcrafts/molvis-sketch-viewer` root entry.
 */
export class MolvisSketchElement extends HTMLElement {
  private composer: SketchComposer | null = null;
  private preview: SketchPreview | null = null;

  static get observedAttributes(): string[] {
    return ["gui", "height", "width", "mode", "label"];
  }

  connectedCallback(): void {
    this.applyBox();
    this.mount();
  }

  disconnectedCallback(): void {
    this.teardown();
  }

  attributeChangedCallback(name: string): void {
    this.applyBox();
    if (name === "label") {
      this.preview?.setTitle(this.getAttribute("label") ?? undefined);
      return;
    }
    if ((name === "mode" || name === "gui") && this.composer) {
      this.teardown();
      this.mount();
    }
  }

  private applyBox(): void {
    const width = this.getAttribute("width")?.trim() || "100%";
    const height = this.getAttribute("height")?.trim() || "360px";
    this.style.display = "block";
    this.style.width = width;
    this.style.height = height;
    this.style.overflow = "hidden";
  }

  private mount(): void {
    if (this.composer) return;
    const mode = parseMode(this.getAttribute("mode"));
    this.dataset.mode = mode;
    const gui = this.getAttribute("gui") !== "false";
    this.composer = new SketchComposer({ gui, mode });
    this.composer.mount(this);
    this.preview = createSketchPreview(this.composer, {
      title: this.getAttribute("label") ?? undefined,
    });
  }

  private teardown(): void {
    this.preview?.destroy();
    this.preview = null;
    this.composer?.unmount();
    this.composer = null;
  }
}

function ensureDefaultStyle(tag: string, declaration: string): void {
  const id = `molvis-sketch-style-${tag}`;
  if (document.getElementById(id)) return;
  const style = document.createElement("style");
  style.id = id;
  style.textContent = `:where(${tag}){${declaration}}`;
  document.head.appendChild(style);
}

/** Define once — the sketch engine barrel stays free of custom-element side effects. */
export function defineMolvisSketch(tag = "molvis-sketch"): void {
  if (!customElements.get(tag)) customElements.define(tag, MolvisSketchElement);
  ensureDefaultStyle(
    tag,
    "display:block;width:100%;height:360px;overflow:hidden;",
  );
}

declare global {
  interface HTMLElementTagNameMap {
    "molvis-sketch": MolvisSketchElement;
  }
}
