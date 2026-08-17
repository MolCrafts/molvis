import { MolvisElement } from "../base";

/**
 * MolvisSeparator — horizontal divider for menu sections.
 */
export class MolvisSeparator extends MolvisElement {
  protected override render(): void {
    this.injectSharedStyles();

    const style = document.createElement("style");
    style.textContent = `
            :host {
                display: block;
                margin: 0.25rem 0;
                padding: 0 0.25rem;
            }

            .separator {
                height: 1px;
                background: var(--border-color);
            }
        `;
    this.root.appendChild(style);

    const separator = document.createElement("div");
    separator.className = "separator";
    this.root.appendChild(separator);
  }
}
