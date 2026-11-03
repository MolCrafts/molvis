import type { GUIComponent } from "../types";

/** One `status-message` beat, as the app emits it. */
export interface StatusBeat {
  text: string;
  type: "info" | "error" | "success" | "warning";
  /** 0-100 while a run is in flight; absent for a terminal message. */
  progress?: number;
}

/** How long a terminal (non-progress) message stays on screen. */
const AUTO_HIDE_MS = 4000;

/**
 * StatusPanel — renders the app's `status-message` stream.
 * Position: bottom-centre (the four corners are taken by view / mode / info /
 * perf).
 *
 * Until this existed, `status-message` had no renderer in the stage's own
 * chrome at all: it reached the console and the hosts that subscribe, so a
 * Quick look user saw neither load phases nor optimize progress — an empty
 * canvas and no explanation. The hover InfoPanel is left alone; status and
 * hover text are different streams and must not clobber each other.
 */
export class StatusPanel implements GUIComponent {
  public element: HTMLElement;
  private label: HTMLElement;
  private bar: HTMLElement;
  private hideTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.element = document.createElement("div");
    this.element.className = "molvis-panel molvis-status-panel";

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
      this.hideTimer = setTimeout(() => this.hide(), AUTO_HIDE_MS);
    }
  }

  public show(): void {
    this.element.classList.add("visible");
  }

  public hide(): void {
    this.element.classList.remove("visible");
  }
}
