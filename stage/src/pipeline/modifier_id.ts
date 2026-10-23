/**
 * Module-level counter for deterministic modifier ids.
 * Avoids non-deterministic Date.now() patterns.
 */
let idCounter = 0;

/** Generate a deterministic modifier id with the given prefix. */
export function nextModifierId(prefix: string): string {
  return `${prefix}-${++idCounter}`;
}
