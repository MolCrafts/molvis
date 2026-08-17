/**
 * Host design tokens for plugin UI.
 *
 * Anything CSS can style uses {@link token}. Canvas / xterm / WebGL call
 * {@link resolveToken} at paint time so light/dark tracks the host.
 */

const TOKEN_FALLBACK = {
  canvas: "#eef1f4",
  panel: "#fafbfc",
  panelRaised: "#eceff2",
  muted: "#e6eaee",
  foreground: "#283038",
  mutedForeground: "#5c666f",
  subtleForeground: "#7b848c",
  border: "#c8d0d8",
  input: "#c8d0d8",
  accent: "#288c82",
  accentForeground: "#f7fbfa",
  interactive: "#e4e9ed",
  interactiveForeground: "#283038",
  scrim: "rgba(24, 31, 47, 0.55)",
  shadowOverlay: "0 12px 32px rgba(0, 0, 0, 0.18)",
} as const;

const STATUS_FALLBACK = {
  failed: "#b43c32",
  completed: "#328c5a",
  warning: "#b48c28",
  running: "#3c6ec8",
} as const;

export type TokenName = keyof typeof TOKEN_FALLBACK;
export type StatusName = keyof typeof STATUS_FALLBACK;

/** `--molvis-` custom-property name for a token. */
export function tokenVar(name: TokenName): string {
  const kebab = name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
  return `--molvis-${kebab}`;
}

/** CSS value for a status colour, e.g. `var(--status-failed-foreground, …)`. */
export function statusToken(name: StatusName): string {
  return `var(--status-${name}-foreground, ${STATUS_FALLBACK[name]})`;
}

/** CSS value for a token, e.g. `var(--molvis-panel, #fafbfc)`. */
export function token(name: TokenName): string {
  return `var(${tokenVar(name)}, ${TOKEN_FALLBACK[name]})`;
}

/**
 * Concrete colour for a token, resolved against the live DOM.
 * Call at paint time so theme changes apply.
 */
export function resolveToken(name: TokenName, element?: Element): string {
  const target =
    element ?? (typeof document === "undefined" ? null : document.body);
  if (!target || typeof getComputedStyle !== "function") {
    return TOKEN_FALLBACK[name];
  }
  const value = getComputedStyle(target).getPropertyValue(tokenVar(name));
  return value.trim() || TOKEN_FALLBACK[name];
}

/** Typography, matching the host chrome plugins render inside. */
export const FONT = {
  sans: "var(--molvis-ui-font, var(--font-sans, Inter, ui-sans-serif, system-ui, sans-serif))",
  mono: "var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace)",
} as const;

/** Stacking order for plugin chrome (host dialogs sit above this band). */
export const Z = {
  popover: 10,
  overlay: 20,
} as const;
