/**
 * Host-owned open state for plugin dialogs.
 *
 * Plugins register content via `api.dialogs`; they open dialogs through
 * `commands.register(..., { toolbar: { opensDialog } })` or by calling
 * {@link openPluginDialog}. The shell ({@link PluginDialogHost}) subscribes
 * and renders the matching contribution.
 */

import { type ContributionListener, Emitter } from "./emitter";

let openDialogId: string | null = null;
const events = new Emitter("dialog host");

export function openPluginDialog(id: string): void {
  if (!id) return;
  if (openDialogId === id) return;
  openDialogId = id;
  events.emit();
}

export function closePluginDialog(): void {
  if (openDialogId === null) return;
  openDialogId = null;
  events.emit();
}

export function getOpenPluginDialogId(): string | null {
  return openDialogId;
}

export function subscribePluginDialogHost(
  listener: ContributionListener,
): () => void {
  return events.subscribe(listener);
}
