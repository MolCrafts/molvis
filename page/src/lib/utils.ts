import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/*
 * tailwind-merge only knows Tailwind's stock scales. Our theme block adds named
 * values (`text-micro`, `h-control-compact`, `rounded-control`, `max-w-dialog-sm`),
 * and leaving them unregistered makes the merge actively wrong in two ways —
 * both reproduced against tailwind-merge 3.6.0:
 *
 *   twMerge("text-body", "text-muted-foreground")   ->  "text-muted-foreground"
 *       The font size is DROPPED. `text-*` falls through to the colour group,
 *       whose validator matches anything, so `body` looks like a competing
 *       colour rather than a size. This is silent: no warning, no visual clue
 *       beyond text rendering at the inherited size.
 *
 *   twMerge("rounded-control", "rounded-lg")        ->  both kept
 *       Unrecognised values are never treated as conflicting, so a caller's
 *       override wins or loses by CSS source order rather than by intent.
 *
 * Registering the scales below is what makes a caller's `className` behave.
 * Keep these lists in sync with the `@theme` block in ../styles/tailwind.css.
 */

/** `--text-*` in the theme block. */
const FONT_SIZES = [
  "micro",
  "label",
  "body",
  "body-lg",
  "title",
  "heading",
  "display",
] as const;

/** `--radius-*` roles. The sm/md/lg/xl aliases are stock names tailwind-merge already knows. */
const RADII = ["control", "panel", "overlay"] as const;

/**
 * Every `--spacing-*` name, registered for all the geometry groups at once.
 *
 * Deliberately not split per utility. A hand-tuned "these names go with `h-`,
 * those with `max-w-`" mapping drifts the moment someone writes `min-h-menu`,
 * and the failure is the silent kind above. Registering a name for a group it
 * is never used with costs nothing.
 */
const SPACING = [
  "compute-list",
  "compute-picker",
  "chart",
  "control",
  "control-comfortable",
  "control-compact",
  "data-count",
  "data-table",
  "dialog-md",
  "dialog-scroll",
  "dialog-sidebar",
  "dialog-sm",
  "dialog-tall",
  "dialog-wide",
  "inspector-overlay",
  "menu",
  "menu-compact",
  "overlay-viewport",
  "pipeline-menu-max",
  "pipeline-menu-min",
  "statusbar",
  "tool-rail",
  "toolbar",
  "touch-target",
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

/**
 * Merge class names, letting later Tailwind utilities win over earlier ones.
 *
 * Every primitive under `components/ui/` composes its classes through this, so
 * a caller's `className` can always override a default without `!important`
 * or ordering luck.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
