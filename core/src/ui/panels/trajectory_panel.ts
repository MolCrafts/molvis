export class MolvisTrajectoryPanel extends HTMLElement {
  static get observedAttributes() {
    return ["length", "current", "playing"];
  }

  private static readonly WIDTH_RATIO = 0.62;
  private static readonly BOTTOM_RATIO = 0.065;
  private static readonly MIN_WIDTH = 280;
  private static readonly MAX_WIDTH = 980;
  private static readonly MIN_BOTTOM = 14;
  private static readonly MAX_BOTTOM = 96;

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
                    --traj-bottom: 36px;
                    position: absolute;
                    bottom: var(--traj-bottom);
                    left: 50%;
                    transform: translateX(-50%);
                    width: var(--traj-width);
                    max-width: calc(100% - 24px);
                    box-sizing: border-box;
                    /* Dark capsule background */
                    background: rgba(30, 30, 30, 0.8);
                    padding: 8px 16px;
                    border-radius: 9999px; /* Capsule shape */
                    border: 1px solid rgba(255, 255, 255, 0.08); /* Subtle border */
                    display: flex;
                    align-items: center;
                    gap: 16px;
                    color: #eeeeee; /* Off-white text */
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
                    z-index: 2000;
                    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
                    transition: opacity 0.3s, transform 0.3s;
                    user-select: none;
                    pointer-events: auto;
                }

                :host([hidden]) {
                    display: none;
                }

                /* Controls Layout */
                .controls {
                    display: flex;
                    flex: 0 0 auto;
                    align-items: center;
                    gap: 12px;
                }

                button {
                    background: transparent;
                    border: none;
                    color: rgba(255, 255, 255, 0.7);
                    cursor: pointer;
                    padding: 0;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    transition: color 0.2s;
                    width: 20px;
                    height: 20px;
                }

                button:hover {
                    color: #ffffff;
                }

                button:active {
                    transform: scale(0.95);
                }

                /* Play button specific adjustment if needed */
                #playBtn svg {
                    width: 14px;
                    height: 14px;
                    fill: currentColor;
                }

                svg {
                    width: 16px;
                    height: 16px;
                    fill: currentColor;
                }

                /* Slider Styling */
                input[type=range] {
                    -webkit-appearance: none;
                    flex: 1 1 auto;
                    min-width: 120px;
                    height: 4px;
                    background: rgba(255, 255, 255, 0.15); /* Track color */
                    border-radius: 2px;
                    outline: none;
                    margin: 0;
                    cursor: pointer;
                }

                input[type=range]::-webkit-slider-thumb {
                    -webkit-appearance: none;
                    width: 12px;
                    height: 12px;
                    background: #ffffff;
                    border-radius: 50%;
                    cursor: pointer;
                    transition: transform 0.15s, box-shadow 0.15s;
                    box-shadow: 0 0 4px rgba(0,0,0,0.3);
                    margin-top: 0; /* Align thumb center if webkit needs it, usually auto centered on height */
                }

                input[type=range]::-webkit-slider-thumb:hover {
                    transform: scale(1.2);
                    box-shadow: 0 0 8px rgba(0,0,0,0.5);
                }

                /* Counter Styling */
                .frame-info {
                    flex: 0 0 auto;
                    font-size: 13px;
                    font-weight: 500;
                    font-variant-numeric: tabular-nums;
                    min-width: 60px;
                    text-align: right;
                    color: rgba(255, 255, 255, 0.9);
                    letter-spacing: 0.5px;
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
    if (name === "length") {
      const len = Number.parseInt(newValue, 10);
      this.slider.max = (len - 1).toString();
      this.totalLabel.textContent = newValue;
      // Hide if 0 or 1 frame
      if (len <= 1) {
        this.setAttribute("hidden", "");
      } else {
        this.removeAttribute("hidden");
      }
    } else if (name === "current") {
      this.slider.value = newValue;
      this.currentLabel.textContent = newValue;
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

  private updateLayoutFromHost(): void {
    const host = this.parentElement as HTMLElement | null;
    if (!host) return;
    const rect = host.getBoundingClientRect();
    this.setViewportSize(rect.width, rect.height);
  }
}
