import type { BondColumnMapping } from "../../pipeline/bond_column_remap";
import { MolvisElement } from "../base";

/**
 * Modal asking which columns of a bonds block hold the two bond endpoints.
 *
 * The framework-free twin of the page's React dialog: hosts that mount the
 * stage's own chrome — the `molvis-viewer` custom element and the VS Code
 * webview — have no component tree to render a picker into, so the stage
 * ships one. `GUIManager` owns the instance and exposes it to the load flow
 * as the fallback `pickBondMapping`.
 *
 * Only reached when the endpoints cannot be inferred
 * (`inferBondColumnMapping`); a LAMMPS `dump local` overlay never opens it.
 *
 * Values are resolved against `atoms.id` downstream, so this asks for column
 * names only — the direct-index offset is a `BondColumnRemapModifier`
 * setting, not a load-time question.
 */
export class MolvisBondMappingDialog extends MolvisElement {
  /** Pending `open()` resolver; non-null exactly while the modal is up. */
  private settle: ((decision: BondColumnMapping | null) => void) | null = null;
  private fileLabel: HTMLElement | null = null;
  private atomiSelect: HTMLSelectElement | null = null;
  private atomjSelect: HTMLSelectElement | null = null;
  private confirmButton: HTMLButtonElement | null = null;
  private sameColumnHint: HTMLElement | null = null;
  private previouslyFocused: HTMLElement | null = null;

  private readonly keydownHandler = (event: KeyboardEvent): void => {
    if (event.key === "Escape") {
      event.stopPropagation();
      this.close(null);
      return;
    }
    if (event.key !== "Tab") return;
    const candidates: Array<HTMLElement | null> = [
      this.atomiSelect,
      this.atomjSelect,
      ...Array.from(this.root.querySelectorAll("button")),
    ];
    const focusable = candidates.filter(
      (el): el is HTMLElement => el !== null && !el.hasAttribute("disabled"),
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = this.ownerDocument.activeElement;
    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  /**
   * Show the modal for `filename` and resolve with the chosen mapping, or
   * `null` when the user cancels (which aborts the load).
   *
   * A second call while one is pending cancels the first, mirroring the
   * page provider — a queued second load must never wait on a dead promise.
   */
  public open(
    filename: string,
    candidates: readonly string[],
  ): Promise<BondColumnMapping | null> {
    this.settle?.(null);
    this.render();
    this.populate(filename, candidates);
    return new Promise<BondColumnMapping | null>((resolve) => {
      this.settle = resolve;
      this.previouslyFocused =
        this.ownerDocument.activeElement instanceof HTMLElement
          ? this.ownerDocument.activeElement
          : null;
      this.hidden = false;
      // Focus after paint so the first Tab lands inside the modal rather
      // than on whatever the canvas had.
      requestAnimationFrame(() => this.atomiSelect?.focus());
      this.ownerDocument.addEventListener("keydown", this.keydownHandler, true);
    });
  }

  /** Resolve the pending `open()` and hide. Safe to call when idle. */
  public close(decision: BondColumnMapping | null): void {
    this.ownerDocument.removeEventListener(
      "keydown",
      this.keydownHandler,
      true,
    );
    this.hidden = true;
    const restore = this.previouslyFocused;
    this.previouslyFocused = null;
    restore?.focus();
    const settle = this.settle;
    this.settle = null;
    settle?.(decision);
  }

  private populate(filename: string, candidates: readonly string[]): void {
    if (this.fileLabel) this.fileLabel.textContent = filename;
    const atomi = this.atomiSelect;
    const atomj = this.atomjSelect;
    if (!atomi || !atomj) return;
    for (const select of [atomi, atomj]) {
      select.replaceChildren();
      for (const column of candidates) {
        const option = document.createElement("option");
        option.value = column;
        option.textContent = column;
        select.appendChild(option);
      }
    }
    // Distinct defaults — the overwhelmingly common file has the two
    // endpoints in adjacent columns, and equal endpoints are refused below.
    atomi.value = candidates[0] ?? "";
    atomj.value = candidates[1] ?? candidates[0] ?? "";
    this.syncConfirmState();
  }

  /** Endpoints must differ: a bond from a row to itself is never meant. */
  private syncConfirmState(): void {
    const same =
      this.atomiSelect !== null &&
      this.atomjSelect !== null &&
      this.atomiSelect.value === this.atomjSelect.value;
    if (this.confirmButton) this.confirmButton.disabled = same;
    if (this.sameColumnHint) this.sameColumnHint.hidden = !same;
  }

  protected override render(): void {
    if (this.atomiSelect) return;

    this.injectSharedStyles();
    this.addEncodedStyles(`
      :host {
        position: absolute;
        inset: 0;
        display: grid;
        place-items: center;
        z-index: 10001;
        pointer-events: auto;
        background: var(--molvis-scrim, oklch(0.12 0.008 255 / 58%));
      }
      :host([hidden]) { display: none; }
      .card {
        min-width: 20rem;
        max-width: min(26rem, calc(100% - 2rem));
        background: var(--bg-color);
        border: 1px solid var(--border-color);
        border-radius: var(--radius);
        box-shadow: var(--shadow);
        padding: 1rem;
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
      }
      h2 {
        margin: 0;
        font-size: var(--text-title, 1rem);
        font-weight: 600;
        line-height: 1.4;
      }
      .file {
        margin: 0;
        color: inherit;
        font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
        font-size: var(--text-label, 12px);
        font-variant-numeric: tabular-nums;
        overflow-wrap: anywhere;
      }
      .why {
        margin: 0;
        color: var(--muted-fg);
        font-size: var(--text-body, 0.875rem);
        line-height: 1.4;
      }
      .fields { display: grid; gap: 0.5rem; }
      label {
        display: grid;
        gap: 0.25rem;
        color: var(--muted-fg);
        font-size: var(--text-label, 12px);
      }
      select {
        width: 100%;
        min-height: var(--row-min-h);
        padding: var(--row-pad-y) var(--row-pad-x);
        color: inherit;
        background: transparent;
        border: 1px solid var(--border-color);
        border-radius: var(--radius-control);
        font: inherit;
        font-size: var(--text-label, 12px);
      }
      .hint {
        margin: 0;
        color: var(--muted-fg);
        font-size: var(--text-micro, 11px);
      }
      .actions {
        display: flex;
        justify-content: flex-end;
        gap: 0.5rem;
      }
      button {
        min-height: var(--row-min-h);
        padding: var(--row-pad-y) 0.75rem;
        color: var(--muted-fg);
        background: transparent;
        border: 0;
        border-radius: var(--radius-control);
        font: inherit;
        font-size: var(--text-label, 12px);
        font-weight: 600;
        cursor: pointer;
        transition: background-color var(--motion-fast) var(--motion-ease), color var(--motion-fast) var(--motion-ease);
      }
      button:hover:not(:disabled) {
        background: var(--hover-color);
        color: inherit;
      }
      button:focus-visible {
        outline: 1px solid var(--accent-color);
        outline-offset: 1px;
      }
      button.primary {
        color: var(--accent-fg);
        background: var(--accent-color);
      }
      button.primary:hover:not(:disabled) {
        color: var(--accent-fg);
      }
      button:disabled { opacity: 0.5; cursor: not-allowed; }
      @media (prefers-reduced-motion: reduce) {
        button { transition: none; }
      }
    `);

    const card = document.createElement("div");
    card.className = "card";
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-modal", "true");
    card.setAttribute("aria-labelledby", "bond-mapping-title");

    const title = document.createElement("h2");
    title.id = "bond-mapping-title";
    title.textContent = "Which columns are the bond endpoints?";

    const file = document.createElement("p");
    file.className = "file";
    this.fileLabel = file;

    const why = document.createElement("p");
    why.className = "why";
    why.textContent =
      "This file's bonds do not use molvis's atomi / atomj columns. Pick the two that hold the endpoint atom ids.";

    const fields = document.createElement("div");
    fields.className = "fields";
    const atomi = this.buildField(fields, "atomi (first endpoint)");
    const atomj = this.buildField(fields, "atomj (second endpoint)");
    this.atomiSelect = atomi;
    this.atomjSelect = atomj;
    for (const select of [atomi, atomj]) {
      select.addEventListener("change", () => this.syncConfirmState());
    }

    const hint = document.createElement("p");
    hint.className = "hint";
    hint.textContent = "Pick two different columns.";
    hint.hidden = true;
    this.sameColumnHint = hint;

    const actions = document.createElement("div");
    actions.className = "actions";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = "Cancel load";
    cancel.addEventListener("click", () => this.close(null));
    const confirm = document.createElement("button");
    confirm.type = "button";
    confirm.className = "primary";
    confirm.textContent = "Map bonds";
    confirm.addEventListener("click", () => this.confirm());
    this.confirmButton = confirm;
    actions.append(cancel, confirm);

    card.append(title, file, why, fields, hint, actions);
    this.root.appendChild(card);
    this.hidden = true;
  }

  private buildField(
    parent: HTMLElement,
    labelText: string,
  ): HTMLSelectElement {
    const label = document.createElement("label");
    const text = document.createElement("span");
    text.textContent = labelText;
    const select = document.createElement("select");
    select.setAttribute("aria-label", labelText);
    label.append(text, select);
    parent.appendChild(label);
    return select;
  }

  private confirm(): void {
    const atomiSource = this.atomiSelect?.value ?? "";
    const atomjSource = this.atomjSelect?.value ?? "";
    if (!atomiSource || !atomjSource || atomiSource === atomjSource) return;
    // Endpoints are atom ids resolved against `atoms.id`; offset is the
    // no-id fallback and stays 0 until a user edits the modifier.
    this.close({ atomiSource, atomjSource, offset: 0 });
  }
}
