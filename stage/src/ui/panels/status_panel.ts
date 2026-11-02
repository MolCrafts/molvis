import type { GUIComponent } from "../types";

/** One `status-message` beat, as the app emits it. */
export interface StatusBeat {
  text: string;
  type: "info" | "error" | "success" | "warning";
  /** 0-100 while a run is in flight; absent for a terminal message. */
  progress?: number;
}

/** How long info/success terminal messages stay on screen. */
const AUTO_HIDE_MS = 4000;
/** How long warning/error terminal messages stay on screen. */
const ALERT_HIDE_MS = 8000;

/**
 * StatusPanel — renders the app's `status-message` stream as a single chip.
 * Position: bottom-centre (the four corners are taken by view / mode / info /
 * perf).
 *
 * Every terminal beat auto-hides; a click dismisses early but is never
 * required. A beat carrying `progress` is a run in flight and stays until the
 * next beat. The hover InfoPanel is left alone; status and hover text are
 * different streams and must not clobber each other.
 */
export class StatusPanel implements GUIComponent {
  public element: HTMLElement;
  private label: HTMLElement;
  private bar: HTMLElement;
  private hideTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.element = document.createElement("div");
    this.element.className = "molvis-panel molvis-status-panel";
    this.element.addEventListener("click", () => this.hide());

    this.label = document.createElement("div");
    this.label.className = "molvis-status-panel__label";
    this.element.appendChild(this.label);

    const track = document.createElement("div");
    track.className = "molvis-status-panel__track";
    this.bar = document.createElement("div");
    this.bar.className = "molvis-status-panel__bar";
    track.appendChild(this.bar);
    this.element.appendChild(track);
  }

  public mount(container: HTMLElement): void {
    container.appendChild(this.element);
  }

  public unmount(): void {
    if (this.hideTimer !== null) clearTimeout(this.hideTimer);
    this.hideTimer = null;
    this.element.remove();
  }

  /**
   * Show one status beat.
   *
   * A beat carrying `progress` is a run in flight: it stays until the next
   * beat. A beat without one is terminal (loaded / failed) and auto-hides, so
   * the canvas does not keep a stale line forever.
   */
  public update(beat: StatusBeat): void {
    const { text, type, progress } = beat;
    const line = text.trim();
    if (!line) {
      this.hide();
      return;
    }
    if (this.hideTimer !== null) {
      clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }

    this.label.textContent = line;
    this.element.dataset.type = type;

    const hasProgress = progress !== undefined && Number.isFinite(progress);
    this.element.classList.toggle("has-progress", hasProgress);
    if (hasProgress) {
      const clamped = Math.max(0, Math.min(100, progress as number));
      this.bar.style.width = `${clamped}%`;
    }
    this.show();

    if (!hasProgress) {
      const delay =
        type === "error" || type === "warning" ? ALERT_HIDE_MS : AUTO_HIDE_MS;
      this.hideTimer = setTimeout(() => this.hide(), delay);
    }
  }

  public show(): void {
    this.element.classList.add("visible");
  }

  public hide(): void {
    this.element.classList.remove("visible");
  }
}
