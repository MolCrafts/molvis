export class MolvisTrajectoryPanel extends HTMLElement {
  static get observedAttributes() {
    return ["length", "current", "playing", "scanning"];
  }

  private static readonly WIDTH_RATIO = 0.62;
  /** Fraction of viewport height from the bottom edge. */
  private static readonly BOTTOM_RATIO = 0.05;
  private static readonly MIN_WIDTH = 280;
  private static readonly MAX_WIDTH = 980;
  /** Floor keeps the capsule clear of the bottom-left hover info readout
   *  (`.molvis-info-panel`, bottom 12px + one monospace line ≈ 40px) on
   *  narrow hosts like the VS Code webview, where the centered capsule
   *  reaches into the readout's column. */
  private static readonly MIN_BOTTOM = 44;
  private static readonly MAX_BOTTOM = 64;

  private shadow: ShadowRoot;
  private slider: HTMLInputElement;
  private currentLabel: HTMLSpanElement;
  private totalLabel: HTMLSpanElement;
  private playBtn: HTMLButtonElement;

  /** rAF handle coalescing rapid slider `input` events into one `seek`
   *  per animation frame; null when no emit is queued. */
  private seekRaf: number | null = null;
  /** Latest slider value awaiting emission on the next animation frame. */
  private pendingSeek: number | null = null;

  constructor() {
    super();
    this.shadow = this.attachShadow({ mode: "open" });
    this.shadow.innerHTML = `
            <style>
                :host {
                    --traj-width: 560px;
                    --traj-bottom: 12px;
                    /* Same aliases as stage menu chrome. Hosts set --molvis-ui-*. */
                    --bg-color: var(--molvis-ui-surface, oklch(0.34 0.012 255 / 0.97));
                    --hover-color: var(--molvis-ui-hover, oklch(1 0 0 / 0.08));
                    --accent-color: var(--molvis-ui-accent, oklch(0.52 0.09 195));
                    --accent-fg: var(--molvis-ui-accent-fg, oklch(0.97 0.01 195));
                    --border-color: var(--molvis-ui-border, oklch(1 0 0 / 0.12));
                    --muted-fg: var(--molvis-ui-muted, oklch(0.74 0.012 255));
                    --radius: var(--molvis-ui-radius, 0.5rem);
                    --row-min-h: var(--molvis-ui-row-min-h, 1.75rem);
                    --motion-fast: var(--molvis-ui-motion-fast, 120ms);
                    --motion-ease: var(--molvis-ui-motion-ease, cubic-bezier(0.2, 0, 0, 1));
                    position: absolute;
                    bottom: var(--traj-bottom);
                    left: 50%;
                    transform: translateX(-50%);
                    width: var(--traj-width);
                    max-width: calc(100% - 24px);
                    box-sizing: border-box;
                    background: var(--bg-color);
                    padding: 4px 8px;
                    border-radius: var(--radius);
                    border: 1px solid var(--border-color);
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    color: var(--molvis-ui-fg, oklch(0.93 0.008 255));
                    font-family: var(--molvis-ui-font, system-ui, -apple-system, "Segoe UI", sans-serif);
                    font-size: var(--molvis-ui-font-size, 0.8125rem);
                    z-index: 2000;
                    user-select: none;
                    pointer-events: auto;
                }

                :host([hidden]) {
                    display: none;
                }

                .controls {
                    display: flex;
                    flex: 0 0 auto;
                    align-items: center;
                    gap: 2px;
                }

                button {
                    background: transparent;
                    border: 0;
                    color: var(--muted-fg);
                    cursor: pointer;
                    padding: 0;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    width: var(--row-min-h);
                    height: var(--row-min-h);
                    border-radius: var(--molvis-ui-radius-control, 0.375rem);
                    transition: background-color var(--motion-fast) var(--motion-ease), color var(--motion-fast) var(--motion-ease);
                }

                button:hover {
                    background: var(--hover-color);
                    color: var(--molvis-ui-fg, oklch(0.93 0.008 255));
                }

                button:focus-visible {
                    outline: 1px solid var(--accent-color);
                    outline-offset: 1px;
                }

                #playBtn {
                    background: var(--accent-color);
                    color: var(--accent-fg);
                }

                #playBtn:hover {
                    color: var(--accent-fg);
                }

                svg {
                    width: 16px;
                    height: 16px;
                    fill: currentColor;
                }

                input[type=range] {
                    -webkit-appearance: none;
                    appearance: none;
                    flex: 1 1 auto;
                    min-width: 120px;
                    height: 4px;
                    background: var(--hover-color);
                    border-radius: 999px;
                    outline: none;
                    margin: 0;
                    cursor: pointer;
                }

                input[type=range]::-webkit-slider-thumb {
                    -webkit-appearance: none;
                    width: 16px;
                    height: 16px;
                    background: var(--accent-color);
                    border: 1px solid var(--bg-color);
                    border-radius: 999px;
                    cursor: pointer;
                }

                .frame-info {
                    flex: 0 0 auto;
                    font-family: var(--font-mono, ui-monospace, monospace);
                    font-size: var(--text-micro, 11px);
                    font-weight: 600;
                    font-variant-numeric: tabular-nums;
                    min-width: 60px;
                    text-align: right;
                    color: var(--muted-fg);
                }

                #current {
                    color: var(--molvis-ui-fg, oklch(0.93 0.008 255));
                }

                @media (prefers-reduced-motion: reduce) {
                    button {
                        transition: none;
                    }
                }
            </style>
            
            <div class="controls">
                <button id="prevBtn" title="Previous Frame (Q)">
                    <!-- Minimal Chevron Left -->
                    <svg viewBox="0 0 24 24"><path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg>
                </button>
                <button id="playBtn" title="Play/Pause (Space)">
                    <!-- Minimal Play Icon (Triangle) -->
                    <svg id="playIcon" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                    <!-- Pause Icon -->
                    <svg id="pauseIcon" viewBox="0 0 24 24" style="display:none"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
                </button>
                <button id="nextBtn" title="Next Frame (E)">
                    <!-- Minimal Chevron Right -->
                    <svg viewBox="0 0 24 24"><path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/></svg>
                </button>
            </div>

            <!-- Slider -->
            <input type="range" id="slider" min="0" max="0" value="0" step="1">

            <!-- Counter -->
            <div class="frame-info">
                <span id="current">0</span> / <span id="total">0</span>
            </div>
        `;

    this.slider = this.shadow.getElementById("slider") as HTMLInputElement;
    this.currentLabel = this.shadow.getElementById(
      "current",
    ) as HTMLSpanElement;
    this.totalLabel = this.shadow.getElementById("total") as HTMLSpanElement;
    this.playBtn = this.shadow.getElementById("playBtn") as HTMLButtonElement;

    this.bindEvents();
  }

  connectedCallback(): void {
    this.updateLayoutFromHost();
  }

  disconnectedCallback(): void {
    if (this.seekRaf !== null) {
      cancelAnimationFrame(this.seekRaf);
      this.seekRaf = null;
    }
    this.pendingSeek = null;
  }

  private bindEvents() {
    // Coalesce rapid drags: the browser fires `input` far faster than a
    // streaming trajectory can load+render a frame. Emit at most one `seek`
    // per animation frame (latest value wins) so the worker never backlogs.
    this.slider.addEventListener("input", () => {
      this.pendingSeek = Number.parseInt(this.slider.value, 10);
      if (this.seekRaf === null) {
        this.seekRaf = requestAnimationFrame(() => {
          this.seekRaf = null;
          if (this.pendingSeek !== null) {
            const val = this.pendingSeek;
            this.pendingSeek = null;
            this.dispatchEvent(new CustomEvent("seek", { detail: val }));
          }
        });
      }
    });

    // `change` fires on pointer-up — guarantee the final resting value lands
    // even if it arrived inside the last throttled frame.
    this.slider.addEventListener("change", () => {
      if (this.seekRaf !== null) {
        cancelAnimationFrame(this.seekRaf);
        this.seekRaf = null;
      }
      this.pendingSeek = null;
      this.dispatchEvent(
        new CustomEvent("seek", {
          detail: Number.parseInt(this.slider.value, 10),
        }),
      );
    });

    this.shadow.getElementById("prevBtn")?.addEventListener("click", () => {
      this.dispatchEvent(new CustomEvent("prev"));
    });

    this.shadow.getElementById("nextBtn")?.addEventListener("click", () => {
      this.dispatchEvent(new CustomEvent("next"));
    });

    this.playBtn.addEventListener("click", () => {
      const isPlaying = this.hasAttribute("playing");
      this.dispatchEvent(new CustomEvent(isPlaying ? "pause" : "play"));
    });

    // Stop propagation to prevent canvas interaction
    const stopPropagation = (e: Event) => {
      e.stopPropagation();
      e.stopImmediatePropagation();
    };
    const events = [
      "pointerdown",
      "pointermove",
      "pointerup",
      "mousedown",
      "mousemove",
      "mouseup",
      "touchstart",
      "touchmove",
      "touchend",
      "click",
      "contextmenu",
      "wheel",
    ];
    for (const evt of events) {
      this.addEventListener(evt, stopPropagation);
    }
  }

  attributeChangedCallback(name: string, _oldValue: string, newValue: string) {
    if (name === "length" || name === "scanning") {
      this.syncReadout();
    } else if (name === "current") {
      this.slider.value = newValue;
      this.syncCurrentLabel();
    } else if (name === "playing") {
      const isPlaying = newValue !== null;
      const playIcon = this.shadow.getElementById("playIcon") as HTMLElement;
      const pauseIcon = this.shadow.getElementById("pauseIcon") as HTMLElement;

      if (isPlaying) {
        playIcon.style.display = "none";
        pauseIcon.style.display = "block";
      } else {
        playIcon.style.display = "block";
        pauseIcon.style.display = "none";
      }
    }
  }

  get length(): number {
    return Number.parseInt(this.getAttribute("length") || "0", 10);
  }

  set length(val: number) {
    this.setAttribute("length", val.toString());
  }

  get current(): number {
    return Number.parseInt(this.getAttribute("current") || "0", 10);
  }

  set current(val: number) {
    this.setAttribute("current", val.toString());
  }

  get scanning(): boolean {
    return this.hasAttribute("scanning");
  }

  set scanning(val: boolean) {
    if (val) this.setAttribute("scanning", "");
    else this.removeAttribute("scanning");
  }

  get playing(): boolean {
    return this.hasAttribute("playing");
  }

  set playing(val: boolean) {
    if (val) {
      this.setAttribute("playing", "");
    } else {
      this.removeAttribute("playing");
    }
  }

  public setViewportSize(width: number, height: number): void {
    const safeWidth = Number.isFinite(width) ? Math.max(0, width) : 0;
    const safeHeight = Number.isFinite(height) ? Math.max(0, height) : 0;

    const panelWidth = Math.min(
      MolvisTrajectoryPanel.MAX_WIDTH,
      Math.max(
        MolvisTrajectoryPanel.MIN_WIDTH,
        Math.round(safeWidth * MolvisTrajectoryPanel.WIDTH_RATIO),
      ),
    );
    const panelBottom = Math.min(
      MolvisTrajectoryPanel.MAX_BOTTOM,
      Math.max(
        MolvisTrajectoryPanel.MIN_BOTTOM,
        Math.round(safeHeight * MolvisTrajectoryPanel.BOTTOM_RATIO),
      ),
    );

    this.style.setProperty("--traj-width", `${panelWidth}px`);
    this.style.setProperty("--traj-bottom", `${panelBottom}px`);
  }

  private syncReadout(): void {
    const len = this.length;
    const scanning = this.scanning;
    this.slider.max = String(Math.max(0, len - 1));
    this.totalLabel.textContent = scanning ? `${len}…` : String(len);
    this.syncCurrentLabel();
    // Scanning (unknown N, including 0/1 indexed frames) must show the
    // indicator. Do not rely on the `hidden` content attribute alone:
    // Chromium's UA `[hidden] { display: none !important }` fights
    // `:host { display: flex }`.
    const show = scanning || len > 1;
    this.toggleAttribute("hidden", !show);
    this.style.display = show ? "flex" : "none";
  }

  private syncCurrentLabel(): void {
    const len = this.length;
    const idx = this.current;
    this.currentLabel.textContent = String(len === 0 ? 0 : idx + 1);
  }

  private updateLayoutFromHost(): void {
    const host = this.parentElement as HTMLElement | null;
    if (!host) return;
    const rect = host.getBoundingClientRect();
    this.setViewportSize(rect.width, rect.height);
  }
}
