/**
 * Imperative focus/open for bottom plugin panels (command palette, etc.).
 * BottomPanelHost subscribes and expands + selects the requested panel.
 */

import { type ContributionListener, Emitter } from "./emitter";

let requestSeq = 0;
let lastRequest: { id: string; seq: number } | null = null;
const events = new Emitter("bottom panel host");

/** Open/focus a bottom panel by namespaced id (e.g. `plugin.com….console`). */
export function openBottomPanel(id: string): void {
  lastRequest = { id, seq: ++requestSeq };
  events.emit();
}

export function getBottomPanelOpenRequest(): {
  id: string;
  seq: number;
} | null {
  return lastRequest;
}

export function subscribeBottomPanelHost(
  listener: ContributionListener,
): () => void {
  return events.subscribe(listener);
}
