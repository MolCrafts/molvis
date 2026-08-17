/**
 * The one listener-set + notify primitive for plugin host state.
 *
 * Five copies of this shape existed (`ContributionStore`, `PluginManager`,
 * the dialog host, the bottom-panel host, and the modifier-panel matcher
 * list) and they did not agree on the part that matters: four logged a
 * throwing listener, one swallowed it with a bare `catch {}`. That meant
 * whether a React subscriber's crash was visible depended on which file it
 * happened to be registered in.
 */

import { HOST_LOG_TAG } from "../constants";

export type ContributionListener = () => void;

export class Emitter {
  private listeners = new Set<ContributionListener>();

  constructor(private readonly label: string) {}

  subscribe(listener: ContributionListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Notify every listener. A throwing listener is reported and the rest
   * still run — one bad subscriber must not stop the others from updating.
   */
  emit(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch (err) {
        console.error(`${HOST_LOG_TAG} ${this.label} listener failed`, err);
      }
    }
  }
}
