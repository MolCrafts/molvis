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
 * Canvas HUD labels (view / mode / info / perf) — text only, no chrome box.
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

.molvis-info-panel {
  bottom: 0.75rem;
  left: 0.75rem;
  font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
  display: none;
  max-width: min(28rem, calc(100% - 1.5rem));
  white-space: pre-wrap;
  word-break: break-word;
}

.molvis-info-panel.visible {
  display: block;
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
}
.molvis-status-panel.visible {
  opacity: 1;
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
.molvis-status-panel[data-type="error"] .molvis-status-panel__label {
  color: #ff6b6b;
}
.molvis-status-panel[data-type="warning"] .molvis-status-panel__label {
  color: #ffb347;
}
`;
