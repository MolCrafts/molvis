import { sketchTokenCssDefaults } from "../style/tokens";

const STYLE_ID = "molvis-sketch-composer-styles";

/**
 * Inject once-per-document styles for {@link SketchComposer} chrome.
 * Prefixed with `.molvis-sketch-composer` so host pages do not clash.
 *
 * Theming: every surface uses `--msk-*` custom properties. Defaults come
 * from {@link SKETCH_TOKEN_DEFAULTS}; hosts override on an ancestor.
 */
export function ensureComposerStyles(): void {
  if (typeof document === "undefined") return;
  // Always refresh text so HMR / package rebuilds pick up CSS without a full
  // document reload (id-only early return used to leave stale layout rules).
  let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement("style");
    style.id = STYLE_ID;
    document.head.appendChild(style);
  }
  style.textContent = COMPOSER_CSS;
}

const COMPOSER_CSS = `
.molvis-sketch-composer {
  /* Token defaults — product hosts override --msk-* on an ancestor. */
  ${sketchTokenCssDefaults()}

  color-scheme: light dark;
  display: grid;
  /* minmax(0,1fr) so the stage can shrink inside narrow drawers / short hosts;
     auto rails keep their content size without blowing the grid. */
  grid-template-rows: auto minmax(0, 1fr) auto;
  grid-template-columns: auto minmax(0, 1fr);
  width: 100%;
  height: 100%;
  max-height: 100%;
  min-height: 0;
  min-width: 0;
  border: 1px solid var(--msk-sep);
  border-radius: var(--msk-radius);
  background: var(--msk-rail-bg);
  color: var(--msk-ink);
  font-family: var(--msk-font);
  box-sizing: border-box;
  /* Contain rails; fragment flyouts use fixed/absolute within the rail. */
  overflow: hidden;
}
.molvis-sketch-composer *,
.molvis-sketch-composer *::before,
.molvis-sketch-composer *::after {
  box-sizing: border-box;
}
.molvis-sketch-composer[data-gui="false"] {
  grid-template-rows: minmax(0, 1fr);
  grid-template-columns: minmax(0, 1fr);
  border: none;
  background: var(--msk-stage-bg);
  overflow: hidden;
}
.molvis-sketch-composer[data-disabled="true"] {
  opacity: 0.6;
}
.molvis-sketch-composer__common {
  grid-column: 1 / -1;
  grid-row: 1;
  display: flex;
  align-items: center;
  gap: 1px;
  padding: 0 4px;
  background: var(--msk-rail-bg);
  border-bottom: 1px solid var(--msk-sep);
  height: var(--msk-btn);
  min-height: var(--msk-btn);
  max-height: var(--msk-btn);
  overflow: hidden;
  border-radius: var(--msk-radius) var(--msk-radius) 0 0;
}
/* Wide: show icon cluster. Narrow: hide it and use ⋯ menu instead. */
.molvis-sketch-composer .msk-common-inline {
  display: flex;
  align-items: center;
  gap: 1px;
  min-width: 0;
  flex-shrink: 0;
}
.molvis-sketch-composer .msk-common-overflow {
  display: none;
  position: relative;
  flex-shrink: 0;
}
.molvis-sketch-composer__common[data-compact="true"] .msk-common-inline {
  display: none;
}
.molvis-sketch-composer__common[data-compact="true"] .msk-common-overflow {
  display: flex;
  align-items: center;
}
.molvis-sketch-composer .msk-common-overflow-menu {
  min-width: 9.5rem;
  padding: 4px;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.molvis-sketch-composer .msk-extra-slot {
  display: inline-flex;
  align-items: center;
  gap: 1px;
  flex-shrink: 0;
  margin-left: auto;
}
.molvis-sketch-composer__chem {
  grid-column: 1;
  grid-row: 2;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1px;
  padding: 4px 0;
  background: var(--msk-rail-bg);
  border-right: 1px solid var(--msk-sep);
  width: var(--msk-btn);
  min-width: var(--msk-btn);
  max-width: var(--msk-btn);
  min-height: 0;
  /* Scroll tools when the drawer is shorter than the chem stack. */
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-width: none;
  -ms-overflow-style: none;
  z-index: 2;
}
.molvis-sketch-composer__chem::-webkit-scrollbar {
  width: 0;
  height: 0;
  display: none;
}
.molvis-sketch-composer__stage {
  grid-column: 2;
  grid-row: 2;
  position: relative;
  min-width: 0;
  min-height: 0;
  background: var(--msk-stage-bg);
  overflow: hidden;
  z-index: 0;
}
.molvis-sketch-composer[data-gui="false"] .molvis-sketch-composer__stage {
  grid-column: 1;
  grid-row: 1;
}
.molvis-sketch-composer__stage canvas {
  display: block;
  width: 100%;
  height: 100%;
  touch-action: none;
  background: var(--msk-stage-bg);
}
.molvis-sketch-composer__stage canvas:focus {
  outline: none;
}
.molvis-sketch-composer__stage canvas:focus-visible {
  outline: 2px solid var(--msk-active-ink);
  outline-offset: -2px;
}
.molvis-sketch-composer__assoc {
  grid-column: 1 / -1;
  grid-row: 3;
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  gap: 4px;
  padding: 2px 4px;
  min-height: var(--msk-btn);
  max-height: calc(var(--msk-btn) * 2.5);
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;
  -ms-overflow-style: none;
  background: var(--msk-rail-bg);
  border-top: 1px solid var(--msk-sep);
  border-radius: 0 0 var(--msk-radius) var(--msk-radius);
}
.molvis-sketch-composer__assoc::-webkit-scrollbar {
  width: 0;
  height: 0;
  display: none;
}
.molvis-sketch-composer[data-gui="false"] .molvis-sketch-composer__common,
.molvis-sketch-composer[data-gui="false"] .molvis-sketch-composer__chem,
.molvis-sketch-composer[data-gui="false"] .molvis-sketch-composer__assoc {
  display: none;
}
.molvis-sketch-composer .msk-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  /* Match --msk-btn so the chem column is never thinner than the buttons
     (fixed 30px buttons in a 28px column was blowing narrow-panel layout). */
  width: var(--msk-btn);
  height: var(--msk-btn);
  margin: 0;
  padding: 0;
  border: none;
  border-radius: var(--msk-radius);
  background: transparent;
  color: var(--msk-ink);
  cursor: pointer;
  flex-shrink: 0;
  line-height: 0;
}
.molvis-sketch-composer .msk-btn:hover {
  background: var(--msk-hover);
}
.molvis-sketch-composer .msk-btn:focus-visible {
  outline: 2px solid var(--msk-active-ink);
  outline-offset: 1px;
}
.molvis-sketch-composer .msk-btn.active {
  background: var(--msk-active-ink);
  color: var(--msk-active-fg);
}
.molvis-sketch-composer .msk-btn:disabled {
  opacity: 0.35;
  cursor: default;
}
.molvis-sketch-composer .msk-btn svg {
  width: calc(var(--msk-btn) * 0.6);
  height: calc(var(--msk-btn) * 0.6);
  max-width: 18px;
  max-height: 18px;
  display: block;
}
.molvis-sketch-composer .msk-btn--preview {
  width: 52px;
  height: 52px;
  padding: 2px;
}
.molvis-sketch-composer .msk-btn--preview svg,
.molvis-sketch-composer .msk-btn--preview img {
  width: 100%;
  height: 100%;
  display: block;
}
.molvis-sketch-composer .msk-sep {
  width: 1px;
  height: calc(var(--msk-btn) * 0.55);
  margin: 0 3px;
  background: var(--msk-sep);
  flex-shrink: 0;
  align-self: center;
}
.molvis-sketch-composer__chem .msk-sep {
  width: calc(var(--msk-btn) * 0.55);
  height: 1px;
  margin: 3px 0;
}
.molvis-sketch-composer .msk-export {
  position: relative;
  flex-shrink: 0;
}
.molvis-sketch-composer .msk-menu {
  position: absolute;
  z-index: 40;
  top: calc(100% + 3px);
  left: 0;
  display: grid;
  min-width: max-content;
  padding: 4px;
  border: 1px solid var(--msk-sep);
  border-radius: calc(var(--msk-radius) + 2px);
  background: var(--msk-stage-bg);
  color: var(--msk-ink);
  box-shadow: var(--msk-shadow);
}
/* Fragment category list: structure thumbnails only (no text labels). */
.molvis-sketch-composer .msk-fragment-control > .msk-menu {
  min-width: 0;
  width: max-content;
}
.molvis-sketch-composer .msk-menu[hidden] {
  display: none;
}
.molvis-sketch-composer .msk-menu--flyout {
  /* Viewport-fixed; coordinates set in JS when opened so chem overflow scroll
     does not clip the palette on short/narrow hosts. */
  position: fixed;
  top: 0;
  left: 0;
  min-width: 0;
  max-height: min(70vh, 420px);
  overflow: auto;
  grid-template-columns: repeat(auto-fill, minmax(52px, 1fr));
  gap: 2px;
  width: max-content;
  max-width: min(90vw, 320px);
  z-index: 50;
}
.molvis-sketch-composer .msk-menu-option {
  padding: 6px 8px;
  border: 0;
  border-radius: var(--msk-radius);
  background: transparent;
  color: var(--msk-ink);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.molvis-sketch-composer .msk-menu-option:hover,
.molvis-sketch-composer .msk-menu-option:focus-visible {
  background: var(--msk-hover);
  outline: none;
}
.molvis-sketch-composer .msk-menu-option:disabled {
  opacity: 0.35;
  cursor: default;
}
/* Icon + label rows for the narrow common-rail ⋯ menu. */
.molvis-sketch-composer .msk-menu-option--icon {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 8.5rem;
  padding: 6px 10px;
  line-height: 1;
}
.molvis-sketch-composer .msk-menu-option--icon .msk-menu-option-icon {
  width: 16px;
  height: 16px;
  flex: 0 0 16px;
  display: block;
}
.molvis-sketch-composer .msk-menu-option--icon .msk-menu-option-label {
  flex: 1 1 auto;
  font-size: 12px;
}
.molvis-sketch-composer .msk-submenu {
  position: relative;
}
.molvis-sketch-composer .msk-fragment-control {
  position: relative;
  flex-shrink: 0;
  z-index: 3;
}
/* Category list opens to the right of the chem rail (not below). */
.molvis-sketch-composer__chem .msk-fragment-control > .msk-menu {
  top: 0;
  left: calc(100% + 4px);
}
.molvis-sketch-composer .msk-category-row {
  display: flex;
  align-items: center;
  gap: 2px;
  width: max-content;
  max-width: 100%;
  padding: 3px 4px;
  border: 0;
  border-radius: var(--msk-radius);
  background: transparent;
  color: var(--msk-ink);
  font: inherit;
  cursor: pointer;
  text-align: left;
}
.molvis-sketch-composer .msk-category-row:hover,
.molvis-sketch-composer .msk-category-row:focus-visible,
.molvis-sketch-composer .msk-category-row[aria-expanded="true"] {
  background: var(--msk-hover);
  outline: none;
}
/* Unclassed SVG defaults are huge in flex rows — pin the chevron. */
.molvis-sketch-composer .msk-category-row > svg.msk-chevron {
  width: 12px;
  height: 12px;
  flex: 0 0 12px;
  opacity: 0.55;
}
.molvis-sketch-composer .msk-category-preview {
  width: 32px;
  height: 32px;
  flex: 0 0 32px;
  display: grid;
  place-items: center;
  overflow: hidden;
}
.molvis-sketch-composer .msk-category-preview svg {
  width: 32px;
  height: 32px;
  display: block;
}
/* Atom-tool quick element chips (C H N O …) in the bottom assoc rail. */
.molvis-sketch-composer .msk-element-chip {
  min-width: var(--msk-btn);
  width: auto;
  padding: 0 6px;
  font-size: 11px;
  font-weight: 600;
  font-family: var(--msk-font);
  letter-spacing: 0.02em;
  line-height: 1;
}
.molvis-sketch-composer .msk-element-chip.active {
  background: var(--msk-active-ink);
  color: var(--msk-active-fg);
}
.molvis-sketch-composer .msk-assoc-color-controls {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-left: auto;
  flex-shrink: 0;
}
.molvis-sketch-composer .msk-assoc-color {
  width: 30px;
  height: 28px;
  border: 1px solid var(--msk-sep);
  border-radius: var(--msk-radius);
  padding: 2px;
  background: transparent;
}
.molvis-sketch-composer .msk-assoc-color:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}
/* Host actions (React portal) — real flex item on the common rail, not overlay. */
.molvis-sketch-composer .msk-extra-slot {
  display: flex;
  align-items: center;
  gap: 1px;
  margin-left: auto;
  flex-shrink: 0;
  min-height: 30px;
}
`;
