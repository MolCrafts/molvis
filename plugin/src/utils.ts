import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/*
 * Same registration as `page/src/lib/utils.ts`, and for the same reason: the
 * host's theme adds named scales that tailwind-merge does not know, and an
 * unregistered scale merges wrongly rather than not at all.
 *
 *   twMerge("text-body", "text-muted-foreground")  ->  the size is DROPPED
 *   twMerge("rounded-control", "rounded-lg")       ->  both kept, order decides
 *
 * A plugin feels this harder than the host does: its whole job is to hand
 * classes to host components and to accept `className` back, so a merge that
 * silently discards a size turns "override the padding" into "lose the type
 * scale". The lists are duplicated rather than imported — a plugin must not
 * depend on the host's internals — so they are kept in sync by hand with the
 * `@theme` block in `page/src/styles/tailwind.css`.
 */

/** `--text-*` in the host theme. */
const FONT_SIZES = [
  "micro",
  "label",
  "body",
  "body-lg",
  "title",
  "heading",
  "display",
] as const;

/** `--radius-*` roles. sm/md/lg/xl are stock names tailwind-merge already knows. */
const RADII = ["control", "panel", "overlay"] as const;

/** Every `--spacing-*` name, registered for all geometry groups at once. */
const SPACING = [
  "analysis-list",
  "analysis-picker",
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

/** Merge Tailwind classes (host token utilities + plugin overrides). */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
