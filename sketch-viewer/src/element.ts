import { SketchComposer } from "@molcrafts/molvis-sketch";

/**
 * Declarative 2D sketch host for documentation and static pages.
 *
 * Mounts {@link SketchComposer}. The engine API stays on
 * `@molcrafts/molvis-sketch`; this class is the custom-element wrapper.
 * CDN registration is the `@molcrafts/molvis-sketch-viewer` root entry.
 */
export class MolvisSketchElement extends HTMLElement {
  private composer: SketchComposer | null = null;

  static get observedAttributes(): string[] {
    return ["gui", "height", "width"];
  }

  connectedCallback(): void {
    this.applyBox();
    this.mount();
  }

  disconnectedCallback(): void {
    this.teardown();
  }

  attributeChangedCallback(): void {
    this.applyBox();
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
    const gui = this.getAttribute("gui") !== "false";
    this.composer = new SketchComposer({ gui });
    this.composer.mount(this);
  }

  private teardown(): void {
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
