import type { TweakpaneGuiComponent } from "../types";
import { Pane } from "tweakpane";
import { draw_frame } from "../../artist/draw";
import type { Molvis } from "../../app";

export class FrameIndicator implements TweakpaneGuiComponent {
  private _app: Molvis;
  private _container: HTMLDivElement;
  private _pane: Pane;
  private _frameLabel!: HTMLInputElement;
  private _frameTotal!: HTMLSpanElement;
  private _bars: HTMLDivElement[] = [];
  private _barContainer!: HTMLDivElement;

  constructor(app: Molvis) {
    this._app = app;
    this._container = this._createContainer();
    this._pane = new Pane({ container: this._container });
    this._setupEventListeners();
  }

  get pane(): Pane {
    return this._pane;
  }

  public updateFrame(current: number, total: number): void {
    this._updateBars(total);
    this._updateHighlight(current);
    this._updateLabels(current, total);
    this._updateVisibility(total);
  }

  public show(): void {
    this._container.style.display = "flex";
  }

  public hide(): void {
    this._container.style.display = "none";
  }

  public dispose(): void {
    this._pane.dispose();
    if (this._container.parentNode) {
      this._container.parentNode.removeChild(this._container);
    }
  }

  private _createContainer(): HTMLDivElement {
    const container = document.createElement("div");
    container.style.cssText = `
      position: absolute;
      bottom: 0;
      left: 0;
      width: 100%;
      padding: 4px;
      background: rgba(0,0,0,0.5);
      display: flex;
      align-items: center;
      box-sizing: border-box;
      color: white;
      font-size: 12px;
      z-index: 1;
    `;

    // Create bar container
    this._barContainer = document.createElement("div");
    this._barContainer.style.cssText = `
      flex: 1;
      display: flex;
      justify-content: space-between;
      height: 10px;
      align-items: flex-end;
    `;
    container.appendChild(this._barContainer);

    // Create frame input
    this._frameLabel = document.createElement("input");
    this._frameLabel.type = "number";
    this._frameLabel.value = "1";
    this._frameLabel.style.cssText = `
      width: 40px;
      margin-left: 8px;
      background: transparent;
      border: 1px solid #666;
      color: white;
    `;

    // Create total label
    this._frameTotal = document.createElement("span");
    this._frameTotal.style.marginLeft = "4px";

    container.appendChild(this._frameLabel);
    container.appendChild(document.createTextNode(" / "));
    container.appendChild(this._frameTotal);

    document.body.appendChild(container);
    container.style.display = "none"; // Hidden by default

    return container;
  }

  private _setupEventListeners(): void {
    let dragging = false;

    const setFrame = (idx: number) => {
      const clampedIdx = Math.max(0, Math.min(idx, this._bars.length - 1));
      this._app.system.set_frame(clampedIdx);
      const frame = this._app.system.current_frame;
      draw_frame(this._app, frame, { atoms: {}, bonds: {}, clean: true });
      this.updateFrame(clampedIdx, this._app.system.n_frames);
    };

    const updateFromEvent = (ev: PointerEvent) => {
      const rect = this._barContainer.getBoundingClientRect();
      const ratio = (ev.clientX - rect.left) / rect.width;
      const idx = Math.floor(ratio * this._bars.length);
      setFrame(idx);
    };

    this._barContainer.addEventListener("pointerdown", (ev) => {
      dragging = true;
      updateFromEvent(ev as PointerEvent);
    });

    this._barContainer.addEventListener("pointermove", (ev) => {
      if (dragging) updateFromEvent(ev as PointerEvent);
    });

    window.addEventListener("pointerup", () => {
      dragging = false;
    });

    this._frameLabel.addEventListener("change", () => {
      const idx = Number.parseInt(this._frameLabel.value) - 1;
      setFrame(idx);
    });
  }

  private _updateBars(total: number): void {
    if (this._bars.length !== total) {
      // Remove old bars
      for (const bar of this._bars) {
        bar.remove();
      }
      this._bars = [];

      // Create new bars
      for (let i = 0; i < total; i++) {
        const bar = document.createElement("div");
        bar.style.cssText = `
          width: 2px;
          margin: 0;
          height: 8px;
          background: white;
          opacity: 0.5;
        `;
        bar.dataset.index = String(i);

        bar.addEventListener("pointerenter", () => {
          bar.style.height = "12px";
        });

        bar.addEventListener("pointerleave", () => {
          if (this._app.system.current_frame_index !== i) {
            bar.style.height = "8px";
          }
        });

        this._barContainer.appendChild(bar);
        this._bars.push(bar);
      }
    }
  }

  private _updateHighlight(current: number): void {
    this._bars.forEach((bar, i) => {
      bar.style.height = i === current ? "12px" : "8px";
    });
  }

  private _updateLabels(current: number, total: number): void {
    this._frameLabel.value = String(current + 1);
    this._frameTotal.textContent = String(total);
  }

  private _updateVisibility(total: number): void {
    if (total > 1) {
      this.show();
    } else {
      this.hide();
    }
  }
}
