import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/*
 * tailwind-merge only knows Tailwind's stock scales. Our constitution theme
 * adds named values (`text-micro`, `h-control-compact`, `rounded-control`,
 * `max-w-dialog-sm`). Leaving them unregistered makes the merge wrong:
 *
 *   twMerge("text-body", "text-muted-foreground")  ->  "text-muted-foreground"
 *       Font size DROPPED — `body` looks like a competing colour token.
 *
 *   twMerge("rounded-control", "rounded-lg")       ->  both kept
 *       Unrecognised values never conflict; order decides visually.
 *
 * Keep FONT_SIZES / RADII in sync with src/styles/tokens.css.
 * SPACING is a **union** of product geometry names so a shared `cn` still
 * merges correctly after products add their own --spacing-* extras.
 */

/** `--text-*` constitution type scale. */
const FONT_SIZES = [
  "micro",
  "label",
  "body",
  "body-lg",
  "title",
  "heading",
  "display",
] as const;

/** `--radius-*` roles (sm/md/lg/xl aliases are stock). */
const RADII = ["control", "panel", "overlay", "checkbox"] as const;

/**
 * Every product `--spacing-*` name we know of, registered for all geometry
 * groups. Registering a name for a group it is never used with is free;
 * missing a real name is the silent bug class above.
 */
const SPACING = [
  // constitution / shared control chrome
  "control",
  "control-comfortable",
  "control-compact",
  "toolbar",
  "toolbar-compact",
  "statusbar",
  "touch-target",
  "menu",
  "menu-compact",
  "dialog-sm",
  "dialog-md",
  "dialog-lg",
  "dialog-wide",
  "dialog-tall",
  "dialog-scroll",
  "dialog-scroll-compact",
  "dialog-viewport",
  "dialog-viewport-tall",
  "dialog-sidebar",
  "overlay-viewport",
  "panel-sm",
  "panel-md",
  "panel-lg",
  "field-label",
  "inspector",
  // molvis extras
  "tool-rail",
  "inspector-overlay",
  "data-count",
  "data-table",
  "chart",
  "analysis-picker",
  "analysis-list",
  "pipeline-menu-min",
  "pipeline-menu-max",
  // molexp extras
  "command-offset",
  "canvas-min",
  "chart-xs",
  "chart-sm",
  "chart-md",
  "chart-lg",
  "chart-xl",
  "structure-preview",
  "compute-list",
  "compute-picker",
] as const;

const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: [...FONT_SIZES] }],
      rounded: [{ rounded: [...RADII] }],
      h: [{ h: [...SPACING] }],
      "min-h": [{ "min-h": [...SPACING] }],
      "max-h": [{ "max-h": [...SPACING] }],
      w: [{ w: [...SPACING] }],
      "min-w": [{ "min-w": [...SPACING] }],
      "max-w": [{ "max-w": [...SPACING] }],
      size: [{ size: [...SPACING] }],
    },
  },
});

/** Merge class names; later Tailwind utilities win over earlier ones. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
