/**
 * Platform conventions shared by every MolVis surface.
 *
 * Lives in `core` because `sketch` and `stage` are peers that cannot
 * import each other, and both need to answer the same question: which key
 * is *the* modifier on this machine. Before this module they each
 * answered it separately, and the sketch board answered it wrongly —
 * `e.metaKey || e.ctrlKey` accepts Ctrl on macOS, where Ctrl+click is the
 * secondary-click gesture, so a Ctrl+click there fired both a
 * context menu and a modifier-click.
 */

export const isMac =
  typeof navigator !== "undefined" &&
  /Mac|iPod|iPhone|iPad/.test(navigator.userAgent);

/**
 * Whether the platform's primary modifier is held: Meta (Command) on
 * macOS, Ctrl everywhere else — never both.
 */
export function isCtrlOrMeta(event: {
  ctrlKey: boolean;
  metaKey: boolean;
}): boolean {
  return isMac ? event.metaKey : event.ctrlKey;
}

/** Display name of the primary modifier, for shortcut hints. */
export function getModifierName(): string {
  return isMac ? "Cmd" : "Ctrl";
}
