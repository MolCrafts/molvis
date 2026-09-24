export const MOLVIS_UI_CSS = `
/* Overlay must live inside .molvis-root (position:relative). Host mounts should
   also be positioned; createMolvisDOM enforces that on the container. */
.molvis-root {
  position: relative;
  isolation: isolate;
  overflow: hidden;
  /*
   * Do not hardcode --molvis-ui-* here: product shells (page Tailwind) set
   * them on .molvis-root. Menu WCs fall back inside SHARED_CSS when unset.
   * Injecting defaults at runtime would clobber host tokens loaded earlier.
   */
}

.molvis-ui-overlay {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 1000;
  font-family: var(
    --molvis-ui-font,
    system-ui,
    -apple-system,
    "Segoe UI",
    sans-serif
  );
  font-size: var(--molvis-ui-font-size, 0.8125rem);
  /* Tracks host chrome: light → dark ink / accent; dark → near-white. */
  color: var(--molvis-ui-panel-fg, var(--molvis-ui-fg, oklch(0.22 0.015 255)));
}

/*
 * Canvas HUD labels (view / mode / perf) — text only, no chrome box. The
 * info readout is the exception: multi-row data over a live canvas needs a
 * solid chip (status-panel language) to stay readable.
 * Color: product shells set --molvis-ui-panel-fg (light: brand teal/green,
 * dark: near-white). Font size inherits from .molvis-ui-overlay
 * (--molvis-ui-font-size); never hardcode px here.
 */
.molvis-panel {
  position: absolute;
  color: var(--molvis-ui-panel-fg, var(--molvis-ui-fg, oklch(0.52 0.12 195)));
  padding: 0.375rem 0.75rem;
  font-size: inherit;
  line-height: 1.4;
  pointer-events: auto;
  user-select: none;
  font-weight: 500;
  background: transparent;
  border: none;
  border-radius: 0;
  box-shadow: none;
  backdrop-filter: none;
  text-shadow: none;
}

.molvis-view-panel {
  top: 0.75rem;
  left: 0.75rem;
}

.molvis-mode-panel {
  top: 0.75rem;
  right: 0.75rem;
}

/*
 * Bottom-left hover readout. Shares the corner with the axis triad: the
 * triad publishes its right edge as --molvis-triad-clearance (px) on
 * .molvis-root (AxisHelper, TRIAD_CLEARANCE_VAR), so the readout starts
 * beside it instead of under it. Fallback 0px keeps the bare-corner layout
 * when decorations are off (no triad).
 */
.molvis-info-panel {
  bottom: 0.75rem;
  left: calc(0.75rem + var(--molvis-triad-clearance, 0px));
  font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
  display: none;
  max-width: min(36rem, calc(100% - 1.5rem));
  max-height: min(40vh, 16rem);
  overflow-y: auto;
  padding: 0.5rem 0.75rem;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
  /* Solid chip so rows stay readable over any canvas colour, same
     treatment as the status panel. */
  background: rgba(28, 32, 40, 0.88);
  border-radius: 0.5rem;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);
  /* Light: theme green from app config; dark override below. */
  color: var(--molvis-ui-hud-fg-light, var(--molvis-ui-accent, oklch(0.52 0.12 195)));
}

:where(.dark, :host(.dark)) .molvis-info-panel,
:where(.dark, :host(.dark)).molvis-root .molvis-info-panel {
  color: var(--molvis-ui-hud-fg-dark, oklch(0.88 0.005 255));
}

.molvis-info-panel.visible {
  display: block;
}

/* Identity line (what was picked), then the data rows under it. */
.molvis-info-panel__header {
  font-weight: 700;
}

.molvis-info-panel__body {
  margin-top: 0.25rem;
}

.molvis-info-panel__body--empty {
  display: none;
}

.molvis-perf-panel {
  bottom: 0.75rem;
  right: 0.75rem;
  font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
}

/* Top centre: the corners are view / mode / info / perf, and the bottom
   centre belongs to the trajectory HUD. */
.molvis-status-panel {
  top: 0.75rem;
  left: 50%;
  transform: translateX(-50%);
  max-width: min(32rem, 70%);
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.18s ease;
  /* Solid chip so text stays readable over any canvas colour. */
  background: rgba(28, 32, 40, 0.88);
  color: #e8eaed;
  border-radius: 999px;
  padding: 0.4rem 0.9rem;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);
  cursor: pointer;
  user-select: none;
}
.molvis-status-panel.visible {
  opacity: 1;
  pointer-events: auto;
}
.molvis-status-panel__label {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.molvis-status-panel__track {
  display: none;
  margin-top: 0.35rem;
  height: 3px;
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.18);
  overflow: hidden;
}
.molvis-status-panel.has-progress .molvis-status-panel__track {
  display: block;
}
.molvis-status-panel__bar {
  height: 100%;
  width: 0%;
  border-radius: 2px;
  background: #4aa3ff;
  transition: width 0.18s ease;
}
.molvis-status-panel[data-type="error"] {
  background: rgba(80, 24, 28, 0.92);
}
.molvis-status-panel[data-type="error"] .molvis-status-panel__label {
  color: #ff8a8a;
}
.molvis-status-panel[data-type="warning"] {
  background: rgba(72, 52, 16, 0.92);
}
.molvis-status-panel[data-type="warning"] .molvis-status-panel__label {
  color: #ffc866;
}
.molvis-status-panel[data-type="success"] .molvis-status-panel__label {
  color: #7ddea2;
}
`;
