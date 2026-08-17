import {
  normalizeElement,
  type PeriodicTableElement,
  PeriodicTableElements,
} from "./elements";

const DEFAULT_TAG_NAME = "molvis-element-picker";
const DEFAULT_ELEMENT = "C";
const ELEMENTS_BY_SYMBOL = new Map(
  PeriodicTableElements.map((element) => [element.symbol, element]),
);

function canonicalElement(value: string): string {
  const normalized = normalizeElement(String(value).trim());
  if (!ELEMENTS_BY_SYMBOL.has(normalized)) {
    throw new TypeError(
      `Invalid element symbol "${value}". Expected a symbol from H through Og.`,
    );
  }
  return normalized;
}

function elementBySymbol(symbol: string): PeriodicTableElement {
  const element = ELEMENTS_BY_SYMBOL.get(symbol);
  if (!element) {
    throw new TypeError(`Periodic-table metadata is missing for ${symbol}.`);
  }
  return element;
}

const STYLES = `
  :host {
    color-scheme: inherit;
    display: inline-block;
    color: var(--molvis-foreground, #202733);
    font-family: var(
      --molvis-font-sans,
      Inter,
      ui-sans-serif,
      system-ui,
      -apple-system,
      sans-serif
    );
    font-size: 0.8125rem;
    line-height: 1.2;
    vertical-align: middle;
  }

  :host([hidden]) {
    display: none;
  }

  button {
    box-sizing: border-box;
    color: inherit;
    font: inherit;
  }

  .trigger {
    display: inline-flex;
    width: 9rem;
    min-width: 0;
    height: 2.25rem;
    align-items: center;
    gap: 0.5rem;
    justify-content: flex-start;
    padding: 0 0.625rem;
    border: 1px solid var(--molvis-input, #cbd2dc);
    border-radius: var(--molvis-radius-control, 0.375rem);
    background: var(--molvis-panel, #ffffff);
    cursor: pointer;
    transition:
      border-color var(--motion-fast, 120ms) ease,
      background var(--motion-fast, 120ms) ease;
  }

  .trigger:hover:not(:disabled) {
    background: var(--molvis-interactive, #eef1f5);
  }

  .trigger:focus-visible,
  .element:focus-visible {
    outline: 2px solid var(--molvis-accent, #087f8c);
    outline-offset: 2px;
  }

  .trigger:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }

  .trigger-symbol {
    display: inline-flex;
    width: 1.625rem;
    height: 1.625rem;
    flex: 0 0 auto;
    align-items: center;
    justify-content: center;
    border-radius: 0.25rem;
    background: var(--molvis-interactive, #eef1f5);
    font-family: var(
      --molvis-font-mono,
      "SFMono-Regular",
      Consolas,
      monospace
    );
    font-size: 0.75rem;
    font-weight: 700;
  }

  .trigger-name {
    min-width: 0;
    flex: 1;
    overflow: hidden;
    text-align: left;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .chevron {
    color: var(--molvis-muted-foreground, #667085);
    font-size: 0.6875rem;
    line-height: 1;
  }

  :host([compact]) .trigger {
    width: 1.75rem;
    height: 1.75rem;
    padding: 0;
    justify-content: center;
    border-radius: var(--molvis-radius-control, 0.375rem);
  }

  :host([compact]) .trigger-symbol {
    width: auto;
    height: auto;
    background: transparent;
  }

  :host([compact]) .trigger-name,
  :host([compact]) .chevron {
    display: none;
  }

  .popover {
    position: fixed;
    inset: auto;
    box-sizing: border-box;
    max-width: calc(100vw - 1rem);
    max-height: calc(100vh - 1rem);
    margin: 0;
    padding: 0;
    overflow: hidden;
    border: 1px solid var(--molvis-border, #d5dae2);
    border-radius: var(--molvis-radius-overlay, 0.625rem);
    background: var(--molvis-panel, #ffffff);
    color: var(--molvis-foreground, #202733);
    box-shadow: var(
      --molvis-shadow-overlay,
      0 0.75rem 2rem rgb(15 23 42 / 18%)
    );
  }

  .popover::backdrop {
    background: transparent;
  }

  .scroll {
    max-width: inherit;
    max-height: inherit;
    overflow: auto;
    padding: 0.625rem;
  }

  .periodic-grid {
    display: grid;
    width: max-content;
    grid-template-columns: repeat(18, 2.125rem);
    grid-template-rows:
      repeat(7, 2.5rem)
      0.375rem
      repeat(2, 2.5rem);
    gap: 0.1875rem;
  }

  .element {
    position: relative;
    display: flex;
    min-width: 0;
    min-height: 0;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 0.1875rem 0.125rem 0.125rem;
    overflow: hidden;
    border: 1px solid color-mix(
      in srgb,
      var(--molvis-border, #d5dae2) 80%,
      transparent
    );
    border-radius: 0.25rem;
    background: var(--molvis-panel-raised, #f3f5f8);
    cursor: pointer;
    transition:
      border-color var(--motion-fast, 120ms) ease,
      background var(--motion-fast, 120ms) ease,
      color var(--motion-fast, 120ms) ease;
  }

  .element[data-block="s"] {
    background: color-mix(
      in srgb,
      var(--molvis-interactive, #eef1f5) 78%,
      #7dd3fc 22%
    );
  }

  .element[data-block="p"] {
    background: color-mix(
      in srgb,
      var(--molvis-interactive, #eef1f5) 78%,
      #86efac 22%
    );
  }

  .element[data-block="d"] {
    background: color-mix(
      in srgb,
      var(--molvis-interactive, #eef1f5) 78%,
      #fde68a 22%
    );
  }

  .element[data-block="f"] {
    background: color-mix(
      in srgb,
      var(--molvis-interactive, #eef1f5) 78%,
      #d8b4fe 22%
    );
  }

  .element:hover {
    border-color: var(--molvis-accent, #087f8c);
  }

  .element[aria-selected="true"] {
    border-color: var(--molvis-accent, #087f8c);
    background: var(--molvis-accent, #087f8c);
    color: var(--molvis-accent-foreground, #ffffff);
  }

  .atomic-number {
    position: absolute;
    top: 0.125rem;
    left: 0.1875rem;
    font-size: 0.4375rem;
    font-variant-numeric: tabular-nums;
    line-height: 1;
    opacity: 0.72;
  }

  .symbol {
    font-family: var(
      --molvis-font-mono,
      "SFMono-Regular",
      Consolas,
      monospace
    );
    font-size: 0.6875rem;
    font-weight: 700;
    line-height: 1;
  }

  .name {
    width: 100%;
    margin-top: 0.1875rem;
    overflow: hidden;
    font-size: 0.375rem;
    line-height: 1;
    opacity: 0.78;
    text-align: center;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  @media (prefers-reduced-motion: reduce) {
    .trigger,
    .element {
      transition: none;
    }
  }
`;

/**
 * @description Framework-free periodic-table input shared by MolVis
 * consumers. It defaults to carbon (`"C"`), reflects `value` and `disabled`
 * between properties and attributes, and accepts `compact` as a presence-only
 * toolbar attribute. Element symbols are normalized and validated; assigning
 * an invalid `value` throws `TypeError` without changing the prior value.
 *
 * Importing this module does not register a tag. After explicit registration,
 * a user selection emits bubbling, composed `input` followed by `change`;
 * programmatic value changes emit neither event.
 *
 * @example
 * ```ts
 * import { defineMolvisElementPicker } from
 *   "@molcrafts/molvis-core/element-picker";
 *
 * defineMolvisElementPicker();
 * const picker = document.createElement("molvis-element-picker");
 * picker.value = "Fe";
 * picker.addEventListener("input", () => console.log(picker.value));
 * document.body.append(picker);
 * ```
 */
export class MolvisElementPickerElement extends HTMLElement {
  static get observedAttributes(): readonly string[] {
    return ["value", "disabled"];
  }

  private currentValue = DEFAULT_ELEMENT;
  private reflectingValue = false;
  private readonly trigger: HTMLButtonElement;
  private readonly triggerSymbol: HTMLSpanElement;
  private readonly triggerName: HTMLSpanElement;
  private readonly popoverPanel: HTMLDivElement;
  private readonly buttons = new Map<string, HTMLButtonElement>();
  private connectionAbortController: AbortController | null = null;

  constructor() {
    super();

    const shadowRoot = this.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = STYLES;

    this.trigger = document.createElement("button");
    this.trigger.type = "button";
    this.trigger.part.add("trigger");
    this.trigger.className = "trigger";
    this.trigger.setAttribute("aria-haspopup", "dialog");
    this.trigger.setAttribute("aria-expanded", "false");

    this.triggerSymbol = document.createElement("span");
    this.triggerSymbol.className = "trigger-symbol";
    this.triggerName = document.createElement("span");
    this.triggerName.className = "trigger-name";
    const chevron = document.createElement("span");
    chevron.className = "chevron";
    chevron.setAttribute("aria-hidden", "true");
    chevron.textContent = "▾";
    this.trigger.append(this.triggerSymbol, this.triggerName, chevron);

    this.popoverPanel = document.createElement("div");
    this.popoverPanel.part.add("popover");
    this.popoverPanel.className = "popover";
    this.popoverPanel.popover = "auto";
    this.popoverPanel.setAttribute("role", "dialog");
    this.popoverPanel.setAttribute("aria-label", "Periodic table");

    const scroll = document.createElement("div");
    scroll.className = "scroll";
    const grid = document.createElement("div");
    grid.className = "periodic-grid";
    grid.setAttribute("role", "grid");
    grid.setAttribute("aria-label", "Chemical elements");

    for (const element of PeriodicTableElements) {
      const button = this.createElementButton(element);
      grid.append(button);
      this.buttons.set(element.symbol, button);
    }

    scroll.append(grid);
    this.popoverPanel.append(scroll);
    shadowRoot.append(style, this.trigger, this.popoverPanel);

    this.trigger.addEventListener("click", () => this.togglePicker());
    this.popoverPanel.addEventListener("toggle", () => {
      const open = this.isPickerOpen();
      this.trigger.setAttribute("aria-expanded", String(open));
      if (open) {
        this.positionPopover();
      }
    });

    this.updateUi();
  }

  /**
   * Selected chemical symbol. Defaults to `"C"`, normalizes letter case, and
   * reflects to the `value` attribute. Invalid symbols throw `TypeError`.
   */
  get value(): string {
    return this.currentValue;
  }

  set value(value: string) {
    const normalized = canonicalElement(value);
    if (this.getAttribute("value") !== normalized) {
      this.reflectValue(normalized);
      return;
    }
    this.setCurrentValue(normalized);
  }

  /**
   * Whether interaction is disabled. This reflects the boolean `disabled`
   * attribute, prevents opening or selection, and closes an open picker.
   */
  get disabled(): boolean {
    return this.hasAttribute("disabled");
  }

  set disabled(value: boolean) {
    this.toggleAttribute("disabled", Boolean(value));
  }

  connectedCallback(): void {
    const attributeValue = this.getAttribute("value");
    if (attributeValue !== null) {
      this.value = attributeValue;
    } else {
      this.updateUi();
    }

    this.connectionAbortController?.abort();
    this.connectionAbortController = new AbortController();
    const { signal } = this.connectionAbortController;
    window.addEventListener("resize", this.repositionIfOpen, { signal });
    window.addEventListener("scroll", this.repositionIfOpen, {
      capture: true,
      signal,
    });
  }

  disconnectedCallback(): void {
    this.connectionAbortController?.abort();
    this.connectionAbortController = null;
  }

  attributeChangedCallback(
    name: string,
    oldValue: string | null,
    newValue: string | null,
  ): void {
    if (oldValue === newValue) return;

    if (name === "disabled") {
      this.updateDisabled();
      return;
    }

    if (name !== "value") return;
    if (newValue === null) {
      this.setCurrentValue(DEFAULT_ELEMENT);
      return;
    }

    if (this.reflectingValue) {
      this.setCurrentValue(canonicalElement(newValue));
      return;
    }

    try {
      const normalized = canonicalElement(newValue);
      if (normalized !== newValue) {
        this.reflectValue(normalized);
      } else {
        this.setCurrentValue(normalized);
      }
    } catch (error) {
      this.reflectValue(this.currentValue);
      throw error;
    }
  }

  private readonly repositionIfOpen = (): void => {
    if (this.isPickerOpen()) this.positionPopover();
  };

  private createElementButton(
    element: PeriodicTableElement,
  ): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.part.add("element-cell", `block-${element.block}`);
    button.className = "element";
    button.dataset.element = element.symbol;
    button.dataset.block = element.block;
    button.dataset.row = String(element.row);
    button.dataset.column = String(element.column);
    button.style.gridColumn = String(element.column);
    button.style.gridRow = String(
      element.row > 7 ? element.row + 1 : element.row,
    );
    button.setAttribute("role", "gridcell");
    button.setAttribute(
      "aria-label",
      `${element.atomicNumber} ${element.name}, ${element.symbol}`,
    );
    button.title = `${element.atomicNumber} · ${element.name} (${element.symbol})`;

    const atomicNumber = document.createElement("span");
    atomicNumber.className = "atomic-number";
    atomicNumber.textContent = String(element.atomicNumber);
    const symbol = document.createElement("span");
    symbol.className = "symbol";
    symbol.textContent = element.symbol;
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = element.name;
    button.append(atomicNumber, symbol, name);

    button.addEventListener("click", () => {
      this.selectFromUser(element.symbol);
    });
    button.addEventListener("keydown", (event) => {
      this.handleGridKeydown(event, element);
    });
    return button;
  }

  private reflectValue(value: string): void {
    if (this.getAttribute("value") === value) {
      this.setCurrentValue(value);
      return;
    }

    this.reflectingValue = true;
    try {
      this.setAttribute("value", value);
    } finally {
      this.reflectingValue = false;
    }
  }

  private setCurrentValue(value: string): void {
    if (this.currentValue !== value) this.currentValue = value;
    this.updateUi();
  }

  private updateUi(): void {
    const selected = elementBySymbol(this.currentValue);
    this.triggerSymbol.textContent = selected.symbol;
    this.triggerName.textContent = selected.name;
    this.trigger.setAttribute(
      "aria-label",
      `Choose element, current ${selected.name} (${selected.symbol})`,
    );
    this.trigger.title = `${selected.name} (${selected.symbol})`;

    for (const [symbol, button] of this.buttons) {
      const active = symbol === this.currentValue;
      button.tabIndex = active ? 0 : -1;
      button.setAttribute("aria-selected", String(active));
    }
    this.updateDisabled();
  }

  private updateDisabled(): void {
    this.trigger.disabled = this.disabled;
    if (this.disabled && this.isPickerOpen()) {
      this.popoverPanel.hidePopover();
    }
  }

  private isPickerOpen(): boolean {
    return this.popoverPanel.matches(":popover-open");
  }

  private togglePicker(): void {
    if (this.disabled) return;
    if (this.isPickerOpen()) {
      this.popoverPanel.hidePopover();
      return;
    }

    this.popoverPanel.showPopover();
    this.positionPopover();
    this.buttons.get(this.currentValue)?.focus();
  }

  private positionPopover(): void {
    const triggerRect = this.trigger.getBoundingClientRect();
    const popoverRect = this.popoverPanel.getBoundingClientRect();
    const viewportPadding = 8;
    const gap = 6;
    const maxLeft = Math.max(
      viewportPadding,
      window.innerWidth - popoverRect.width - viewportPadding,
    );
    const left = Math.min(Math.max(triggerRect.left, viewportPadding), maxLeft);

    const spaceBelow = window.innerHeight - triggerRect.bottom;
    const fitsBelow = spaceBelow >= popoverRect.height + gap + viewportPadding;
    const above = triggerRect.top - popoverRect.height - gap;
    const top = fitsBelow
      ? triggerRect.bottom + gap
      : Math.max(viewportPadding, above);

    this.popoverPanel.style.left = `${Math.round(left)}px`;
    this.popoverPanel.style.top = `${Math.round(top)}px`;
  }

  private handleGridKeydown(
    event: KeyboardEvent,
    element: PeriodicTableElement,
  ): void {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      this.selectFromUser(element.symbol);
      return;
    }

    const direction = {
      ArrowDown: "down",
      ArrowLeft: "left",
      ArrowRight: "right",
      ArrowUp: "up",
    }[event.key] as "down" | "left" | "right" | "up" | undefined;
    if (!direction) return;

    event.preventDefault();
    const neighbor = this.findNeighbor(element, direction);
    this.buttons.get(neighbor.symbol)?.focus();
  }

  private findNeighbor(
    origin: PeriodicTableElement,
    direction: "down" | "left" | "right" | "up",
  ): PeriodicTableElement {
    const horizontal = direction === "left" || direction === "right";
    const candidates = PeriodicTableElements.filter((element) => {
      if (horizontal && element.row !== origin.row) return false;
      if (!horizontal && element.column !== origin.column) return false;
      if (direction === "left") return element.column < origin.column;
      if (direction === "right") return element.column > origin.column;
      if (direction === "up") return element.row < origin.row;
      return element.row > origin.row;
    });

    candidates.sort((left, right) => {
      const leftDistance = horizontal
        ? Math.abs(left.column - origin.column)
        : Math.abs(left.row - origin.row);
      const rightDistance = horizontal
        ? Math.abs(right.column - origin.column)
        : Math.abs(right.row - origin.row);
      return leftDistance - rightDistance;
    });
    return candidates[0] ?? origin;
  }

  private selectFromUser(symbol: string): void {
    if (this.disabled) return;
    this.value = symbol;
    this.popoverPanel.hidePopover();
    this.trigger.focus();
    this.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    this.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
  }
}

/**
 * @description Idempotently register the shared periodic-table picker. The
 * function consults `customElements.get()` first, so repeated calls for the
 * same tag are safe. Importing the module alone has no registration side
 * effect.
 *
 * @param {string} tag - Custom-element tag to register. Defaults to
 * `"molvis-element-picker"`.
 * @returns {void}
 *
 * @example
 * ```ts
 * defineMolvisElementPicker();
 * document.body.append(document.createElement("molvis-element-picker"));
 * ```
 */
export function defineMolvisElementPicker(tag = DEFAULT_TAG_NAME): void {
  if (!customElements.get(tag)) {
    customElements.define(tag, MolvisElementPickerElement);
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "molvis-element-picker": MolvisElementPickerElement;
  }
}
