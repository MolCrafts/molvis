/**
 * Shared design tokens for stage menu / chrome web components (shadow DOM).
 *
 * Hosts (e.g. page) override `--molvis-ui-*` on `.molvis-root` or an ancestor.
 * Components map those into local aliases (`--bg-color`, …) used in styles.
 *
 * Standalone defaults match the product dark gun-metal stack so demos stay
 * readable on a 3D canvas without page tokens.
 */
export const SHARED_CSS = `
    :host {
        display: block;
        box-sizing: border-box;
        font-family: var(
            --molvis-ui-font,
            system-ui,
            -apple-system,
            "Segoe UI",
            sans-serif
        );
        font-size: var(--molvis-ui-font-size, 0.8125rem);
        line-height: 1.4;
        color: var(--molvis-ui-fg, oklch(0.93 0.008 255));

        /* Local aliases (components already use these names). */
        --bg-color: var(
            --molvis-ui-surface,
            oklch(0.34 0.012 255 / 0.97)
        );
        --hover-color: var(
            --molvis-ui-hover,
            oklch(1 0 0 / 0.08)
        );
        --accent-color: var(
            --molvis-ui-accent,
            oklch(0.52 0.09 195)
        );
        --accent-fg: var(
            --molvis-ui-accent-fg,
            oklch(0.97 0.01 195)
        );
        --border-color: var(
            --molvis-ui-border,
            oklch(1 0 0 / 0.12)
        );
        --muted-fg: var(
            --molvis-ui-muted,
            oklch(0.74 0.012 255)
        );
        --radius: var(--molvis-ui-radius, 0.5rem);
        --shadow: var(
            --molvis-ui-shadow,
            0 0.75rem 2rem oklch(0.08 0.01 255 / 0.4)
        );
        --row-min-h: var(--molvis-ui-row-min-h, 1.75rem);
        --row-pad-x: var(--molvis-ui-row-pad-x, 0.5rem);
        --row-pad-y: var(--molvis-ui-row-pad-y, 0.375rem);
        --motion-fast: var(--molvis-ui-motion-fast, 120ms);
        --motion-ease: var(
            --molvis-ui-motion-ease,
            cubic-bezier(0.2, 0, 0, 1)
        );
    }

    * {
        box-sizing: border-box;
    }
`;

export class MolvisElement extends HTMLElement {
  protected root: ShadowRoot;

  constructor() {
    super();
    this.root = this.attachShadow({ mode: "open" });
  }

  connectedCallback() {
    this.render();
  }

  protected render() {
    // Override in subclasses
  }

  protected addEncodedStyles(css: string) {
    const style = document.createElement("style");
    style.textContent = css;
    this.root.appendChild(style);
  }

  protected injectSharedStyles() {
    this.addEncodedStyles(SHARED_CSS);
  }
}
