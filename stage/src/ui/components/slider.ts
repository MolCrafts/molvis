import {
  defineMolvisElementPicker,
  type MolvisElementPickerElement,
} from "@molcrafts/molvis-core/element-picker";
import type { BindingOption, MenuItem } from "../../mode/types";
import { MolvisElement } from "../base";

/** Render list, checkbox, range, and shared element-picker menu bindings. */
export class MolvisSlider extends MolvisElement {
  private _data: Extract<MenuItem, { type: "binding" }> | null = null;
  private _rendered = false;
  private _abortController: AbortController | null = null;

  set data(item: MenuItem) {
    if (item.type !== "binding") {
      throw new Error("MolvisSlider only accepts binding menu items");
    }
    this._data = item;
    if (!this._rendered) {
      this.render();
      this._rendered = true;
    }
  }

  connectedCallback() {
    // Don't render if already rendered via data setter
    if (!this._rendered) {
      this.render();
      this._rendered = true;
    }
  }

  disconnectedCallback() {
    if (this._abortController) {
      this._abortController.abort();
      this._abortController = null;
    }
  }

  protected override render(): void {
    // Abort previous listeners before re-rendering
    if (this._abortController) {
      this._abortController.abort();
    }
    this._abortController = new AbortController();
    const signal = this._abortController.signal;

    // Clear previous content
    this.root.innerHTML = "";

    this.injectSharedStyles();

    const style = document.createElement("style");
    style.textContent = `
            :host {
                display: block;
            }

            .binding {
                padding: var(--row-pad-y) var(--row-pad-x);
                min-height: var(--row-min-h);
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 0.5rem;
                border-radius: calc(var(--radius) - 2px);
            }

            .binding-label {
                font-size: inherit;
                color: inherit;
                margin-right: 0.5rem;
                white-space: nowrap;
            }

            .binding-control {
                display: flex;
                align-items: center;
                flex: 1;
                min-width: 0;
            }

            input[type="checkbox"] {
                cursor: pointer;
                width: 1rem;
                height: 1rem;
                accent-color: var(--accent-color);
            }

            select {
                flex: 1;
                background: var(--hover-color);
                border: 1px solid var(--border-color);
                border-radius: calc(var(--radius) - 2px);
                color: inherit;
                padding: 0.25rem 0.5rem;
                font-size: inherit;
                font-family: inherit;
                cursor: pointer;
                outline: none;
            }

            select:hover {
                filter: brightness(1.05);
            }

            select:focus {
                border-color: var(--accent-color);
            }

            option {
                background: var(--bg-color);
                color: inherit;
            }

            input[type="range"] {
                flex: 1;
                min-width: 7.5rem;
                accent-color: var(--accent-color);
                cursor: pointer;
            }

            .range-value {
                width: 2.75rem;
                text-align: right;
                font-size: 0.75rem;
                color: var(--muted-fg);
                font-variant-numeric: tabular-nums;
            }

            molvis-element-picker {
                --molvis-foreground: var(--molvis-ui-fg, inherit);
                --molvis-muted-foreground: var(--muted-fg);
                --molvis-panel: var(--bg-color);
                --molvis-panel-raised: var(--bg-color);
                --molvis-input: var(--border-color);
                --molvis-border: var(--border-color);
                --molvis-interactive: var(--hover-color);
                --molvis-accent: var(--accent-color);
                --molvis-accent-foreground: var(--accent-fg);
                --molvis-shadow-overlay: var(--shadow);
            }
        `;
    this.root.appendChild(style);

    const container = document.createElement("div");
    container.className = "binding";

    const config = this._data?.bindingConfig;

    if (config?.label) {
      const label = document.createElement("div");
      label.className = "binding-label";
      label.textContent = config.label;
      container.appendChild(label);
    }

    const controlContainer = document.createElement("div");
    controlContainer.className = "binding-control";

    // The full periodic-table UI remains owned by the shared core component.
    if (config?.view === "element-picker") {
      defineMolvisElementPicker();
      const picker = document.createElement(
        "molvis-element-picker",
      ) as MolvisElementPickerElement;
      picker.setAttribute("compact", "");
      picker.value = String(config.value);

      const stopPropagation = (event: Event) => {
        event.stopPropagation();
      };

      picker.addEventListener("click", stopPropagation, { signal });
      picker.addEventListener(
        "input",
        (event) => {
          event.stopPropagation();
          this._data?.action({ value: picker.value });
        },
        { signal },
      );
      picker.addEventListener("change", stopPropagation, { signal });

      controlContainer.appendChild(picker);
    } else if (config?.view === "checkbox") {
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = !!config.value;

      checkbox.addEventListener(
        "click",
        (e) => {
          e.stopPropagation();
        },
        { signal },
      );

      checkbox.addEventListener(
        "change",
        (e) => {
          e.stopPropagation();
          const target = e.target as HTMLInputElement;
          this._data?.action({ value: target.checked });
        },
        { signal },
      );

      controlContainer.appendChild(checkbox);
    } else if (config?.view === "list") {
      // Dropdown list
      const select = document.createElement("select");

      if (config.options) {
        for (const option of config.options as BindingOption[]) {
          const optionEl = document.createElement("option");
          optionEl.value = String(option.value);
          optionEl.textContent = option.text;

          if (option.value === config.value) {
            optionEl.selected = true;
          }

          select.appendChild(optionEl);
        }
      }

      select.addEventListener(
        "click",
        (e) => {
          e.stopPropagation(); // Prevent click-through when opening dropdown
        },
        { signal },
      );

      select.addEventListener(
        "change",
        (e) => {
          e.stopPropagation();
          const target = e.target as HTMLSelectElement;
          const value = target.value;

          // Try to parse as number if it looks like a number
          const parsedValue = Number.isNaN(Number(value))
            ? value
            : Number(value);

          this._data?.action({ value: parsedValue });
        },
        { signal },
      );

      controlContainer.appendChild(select);
    } else if (config?.view === "slider") {
      const slider = document.createElement("input");
      slider.type = "range";
      slider.min = String(config.min ?? 0);
      slider.max = String(config.max ?? 1);
      slider.step = String(config.step ?? 0.01);

      const initial =
        typeof config.value === "number" ? config.value : Number(config.value);
      slider.value = Number.isFinite(initial) ? String(initial) : "0";

      const valueLabel = document.createElement("span");
      valueLabel.className = "range-value";
      valueLabel.textContent = Number(slider.value).toFixed(2);

      const stopPropagation = (e: Event) => {
        e.stopPropagation();
      };

      slider.addEventListener("mousedown", stopPropagation, { signal });
      slider.addEventListener("click", stopPropagation, { signal });
      slider.addEventListener(
        "input",
        (e) => {
          e.stopPropagation();
          const target = e.target as HTMLInputElement;
          const next = Number(target.value);
          valueLabel.textContent = Number.isFinite(next)
            ? next.toFixed(2)
            : target.value;
          this._data?.action({ value: next });
        },
        { signal },
      );
      slider.addEventListener("change", stopPropagation, { signal });

      controlContainer.appendChild(slider);
      controlContainer.appendChild(valueLabel);
    }

    container.appendChild(controlContainer);
    this.root.appendChild(container);
  }
}
