import type { SketchComposer } from "@molcrafts/molvis-sketch";
import editorCss from "./sketch_editor.css?raw";
import {
  type LinkSide,
  type LinkState,
  SketchStageLink,
} from "./sketch_stage_link";
import type { StageCompanion, StageCompanionSnapshot } from "./stage_companion";

/** Standalone editing chrome; Stage is imported only by a manual open action. */
export class SketchEditor {
  private readonly root = document.createElement("main");
  private readonly sketchHost = document.createElement("section");
  private readonly pane = document.createElement("section");
  private readonly stageHost = document.createElement("div");
  private readonly toggle = document.createElement("button");
  private readonly closeButton = document.createElement("button");
  private readonly divider = document.createElement("div");
  private readonly menu = document.createElement("div");
  private readonly menuToggle = document.createElement("button");
  private readonly status = document.createElement("p");
  private readonly retry = document.createElement("button");
  private companion: StageCompanion | null = null;
  private link: SketchStageLink | null = null;
  private open = false;
  private generation = 0;
  private ratio = 55;
  private retrySource: LinkSide = "sketch";
  private returnFocus: HTMLElement | null = null;
  private container: HTMLElement | null = null;
  private transition: Promise<void> = Promise.resolve();
  private linkedReady = false;
  private saved: { state: StageCompanionSnapshot; topology: string } | null =
    null;

  constructor(private readonly composer: SketchComposer) {
    this.root.className = "msk-editor";
    this.root.dataset.open = "false";
    this.root.setAttribute("aria-label", "Molecule editor");
    const style = document.createElement("style");
    style.textContent = editorCss;
    this.root.append(style);
    this.sketchHost.className = "msk-editor__drawing";
    this.sketchHost.setAttribute("aria-label", "2D drawing");
    this.pane.className = "msk-editor__3d";
    this.pane.id = `msk-3d-${crypto.randomUUID()}`;
    this.pane.hidden = true;
    this.pane.setAttribute("aria-label", "3D structure editor");

    this.toggle.type = "button";
    this.toggle.className = "msk-btn msk-editor__toggle";
    this.toggle.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Zm0 9 8-4.5M12 12 4 7.5M12 12v9"/></svg><span>3D</span>';
    this.toggle.setAttribute("aria-controls", this.pane.id);
    this.toggle.addEventListener("click", this.onToggle);

    const header = document.createElement("header");
    header.className = "msk-editor__header";
    const title = document.createElement("h2");
    title.textContent = "3D structure";
    const linked = document.createElement("span");
    linked.className = "msk-editor__linked";
    linked.textContent = "Linked editing";
    this.closeButton.type = "button";
    this.closeButton.className = "msk-editor__close";
    this.closeButton.setAttribute("aria-label", "Close 3D structure");
    this.closeButton.title = "Close 3D structure";
    this.closeButton.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>';
    this.closeButton.addEventListener("click", () => {
      void this.setOpen(false);
      this.toggle.focus();
    });
    header.append(title, linked, this.closeButton);
    this.stageHost.className = "msk-editor__stage";
    const footer = document.createElement("footer");
    footer.className = "msk-editor__status";
    this.status.setAttribute("role", "status");
    this.retry.type = "button";
    this.retry.textContent = "Retry";
    this.retry.hidden = true;
    this.retry.addEventListener("click", () => {
      if (this.link) void this.link.syncFrom(this.retrySource);
      else {
        void this.setOpen(false).then(() => this.setOpen(true));
      }
    });
    footer.append(this.status, this.retry);
    this.pane.append(header, this.stageHost, footer);

    this.divider.className = "msk-editor__divider";
    this.divider.hidden = true;
    this.divider.tabIndex = 0;
    this.divider.setAttribute("role", "separator");
    this.divider.setAttribute("aria-label", "Resize 2D and 3D views");
    this.divider.setAttribute("aria-controls", this.pane.id);
    this.divider.setAttribute("aria-valuemin", "25");
    this.divider.setAttribute("aria-valuemax", "75");
    this.divider.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      this.divider.setPointerCapture(event.pointerId);
    });
    this.divider.addEventListener("pointermove", (event) => {
      if (!this.divider.hasPointerCapture(event.pointerId)) return;
      const rect = this.root.getBoundingClientRect();
      const stacked = this.stacked();
      this.setRatio(
        100 *
          (stacked
            ? (event.clientY - rect.top) / rect.height
            : (event.clientX - rect.left) / rect.width),
      );
    });
    this.divider.addEventListener("pointerup", (event) => {
      if (this.divider.hasPointerCapture(event.pointerId)) {
        this.divider.releasePointerCapture(event.pointerId);
      }
    });
    this.divider.addEventListener("keydown", (event) => {
      const decrease = this.stacked() ? "ArrowUp" : "ArrowLeft";
      const increase = this.stacked() ? "ArrowDown" : "ArrowRight";
      if (![decrease, increase, "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      this.setRatio(
        event.key === "Home"
          ? 25
          : event.key === "End"
            ? 75
            : this.ratio + (event.key === decrease ? -5 : 5),
      );
    });

    this.menu.className = "msk-editor__menu";
    this.menu.hidden = true;
    this.menu.setAttribute("role", "menu");
    this.menu.setAttribute("aria-label", "Drawing view");
    this.menuToggle.type = "button";
    this.menuToggle.setAttribute("role", "menuitemcheckbox");
    this.menuToggle.textContent = "Show 3D structure";
    this.menuToggle.addEventListener("click", () => {
      this.dismissMenu();
      this.onToggle();
    });
    this.menu.append(this.menuToggle);
    this.root.append(this.sketchHost, this.divider, this.pane, this.menu);
    this.refreshToggle();
    this.setRatio(this.ratio);
  }

  mount(container: HTMLElement): void {
    this.container = container;
    container.append(this.root);
    this.composer.mount(this.sketchHost);
    this.composer.extraSlot.append(this.toggle);
    this.sketchHost.addEventListener("contextmenu", this.onContextMenu);
    this.sketchHost.addEventListener("keydown", this.onContextKey);
    document.addEventListener("pointerdown", this.onOutsidePointer);
    document.addEventListener("keydown", this.onDocumentKey);
    window.addEventListener("resize", this.onResize);
  }

  async destroy(): Promise<void> {
    this.generation++;
    this.sketchHost.removeEventListener("contextmenu", this.onContextMenu);
    this.sketchHost.removeEventListener("keydown", this.onContextKey);
    document.removeEventListener("pointerdown", this.onOutsidePointer);
    document.removeEventListener("keydown", this.onDocumentKey);
    window.removeEventListener("resize", this.onResize);
    await this.setOpen(false);
    this.saved?.state.frame.free();
    this.saved = null;
    this.toggle.remove();
    if (this.container) this.composer.mount(this.container);
    this.root.remove();
    this.container = null;
  }

  private readonly onToggle = (): void => {
    void this.setOpen(!this.open);
  };
  private readonly onResize = (): void => {
    this.setRatio(this.ratio);
  };
  private readonly onContextMenu = (event: MouseEvent): void => {
    event.preventDefault();
    this.showMenu(event.clientX, event.clientY);
  };
  private readonly onContextKey = (event: KeyboardEvent): void => {
    if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10"))
      return;
    event.preventDefault();
    const rect = this.sketchHost.getBoundingClientRect();
    this.showMenu(rect.left + rect.width / 2, rect.top + rect.height / 2);
  };
  private readonly onOutsidePointer = (event: PointerEvent): void => {
    if (!this.menu.contains(event.target as Node)) this.dismissMenu(false);
  };
  private readonly onDocumentKey = (event: KeyboardEvent): void => {
    if (this.menu.hidden) return;
    if (event.key === "Escape" || event.key === "Tab") this.dismissMenu();
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      this.menuToggle.focus();
    }
  };

  private showMenu(x: number, y: number): void {
    this.returnFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    this.menu.hidden = false;
    const rect = this.menu.getBoundingClientRect();
    this.menu.style.left = `${Math.max(4, Math.min(x, window.innerWidth - rect.width - 4))}px`;
    this.menu.style.top = `${Math.max(4, Math.min(y, window.innerHeight - rect.height - 4))}px`;
    this.menuToggle.focus();
  }

  private dismissMenu(restoreFocus = true): void {
    if (this.menu.hidden) return;
    this.menu.hidden = true;
    if (restoreFocus) this.returnFocus?.focus();
  }

  private stacked(): boolean {
    return window.matchMedia("(max-width: 720px)").matches;
  }

  private setRatio(ratio: number): void {
    this.ratio = Math.max(25, Math.min(75, ratio));
    this.root.style.setProperty("--msk-left", `${this.ratio}fr`);
    this.root.style.setProperty("--msk-right", `${100 - this.ratio}fr`);
    this.divider.setAttribute("aria-valuenow", String(this.ratio));
    this.divider.setAttribute(
      "aria-orientation",
      this.stacked() ? "horizontal" : "vertical",
    );
  }

  private refreshToggle(): void {
    const label = this.open ? "Hide 3D structure" : "Show 3D structure";
    this.toggle.title = label;
    this.toggle.setAttribute("aria-label", label);
    this.toggle.setAttribute("aria-pressed", String(this.open));
    this.toggle.setAttribute("aria-expanded", String(this.open));
    this.menuToggle.setAttribute("aria-checked", String(this.open));
  }

  private readonly onLinkState = (state: LinkState): void => {
    if (!this.open) return;
    this.linkedReady = state.kind === "ready";
    this.retry.hidden = state.kind !== "error";
    this.status.dataset.kind = state.kind;
    this.stageHost.style.pointerEvents =
      state.kind === "syncing" && state.target === "stage" ? "none" : "";
    if (state.kind === "error") {
      this.retrySource = state.source;
      this.status.textContent = `Could not update ${state.source === "sketch" ? "3D" : "2D"}: ${state.message}`;
    } else if (state.kind === "syncing") {
      this.status.textContent = `Updating ${state.target === "stage" ? "3D" : "2D"}…`;
    } else {
      this.status.textContent =
        this.composer.counts().atoms === 0
          ? "Draw in either view to begin."
          : "Edit either view to update the structure.";
    }
  };

  private setOpen(open: boolean): Promise<void> {
    if (this.open === open) return this.transition;
    this.open = open;
    const generation = ++this.generation;
    this.root.dataset.open = String(open);
    this.pane.hidden = !open;
    this.divider.hidden = !open;
    this.refreshToggle();
    this.transition = this.transition
      .then(async () => {
        if (!open) {
          const companion = this.companion;
          const link = this.link;
          this.companion = null;
          this.link = null;
          await link?.stop();
          if (companion) {
            try {
              if (this.linkedReady) {
                const state = await companion.capture();
                const previous = this.saved;
                this.saved = {
                  state,
                  topology: SketchStageLink.topologyOf(
                    this.composer.board.getMoleculeData(),
                  ),
                };
                previous?.state.frame.free();
              }
            } finally {
              companion.destroy();
            }
          }
          return;
        }
        if (!this.open || generation !== this.generation) return;
        this.status.textContent = "Opening 3D structure…";
        this.retry.hidden = true;
        this.linkedReady = false;
        let companion: StageCompanion | null = null;
        let saved: StageCompanionSnapshot | null = null;
        try {
          const { StageCompanion } = await import("./stage_companion");
          if (!this.open || generation !== this.generation) return;
          const drawing = this.composer.board.getMoleculeData();
          if (this.saved?.topology === SketchStageLink.topologyOf(drawing)) {
            saved = this.saved.state;
          } else {
            this.saved?.state.frame.free();
          }
          this.saved = null;
          companion = new StageCompanion(
            this.stageHost,
            () => this.composer.board.getMoleculeData(),
            saved,
          );
          await companion.start();
          if (!this.open || generation !== this.generation) {
            companion.destroy();
            return;
          }
          this.companion = companion;
          this.link = new SketchStageLink(
            {
              read: () => this.composer.board.getMoleculeData(),
              write: (data) => {
                this.composer.board.updateMoleculeData(data);
                this.composer.board.fitToView();
              },
              subscribe: (listener) => this.composer.board.subscribe(listener),
            },
            companion,
            (state) => {
              if (generation === this.generation) this.onLinkState(state);
            },
          );
          await this.link.start(saved ? drawing : undefined);
        } catch (error) {
          if (!companion) saved?.frame.free();
          if (this.companion !== companion) companion?.destroy();
          if (this.open && generation === this.generation) {
            this.onLinkState({
              kind: "error",
              source: "sketch",
              message: error instanceof Error ? error.message : String(error),
            });
          }
        }
      })
      .catch((error: unknown) => {
        if (this.open && generation === this.generation) {
          this.onLinkState({
            kind: "error",
            source: "sketch",
            message: error instanceof Error ? error.message : String(error),
          });
        }
      });
    return this.transition;
  }
}
