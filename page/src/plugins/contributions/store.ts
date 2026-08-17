/**
 * Tiny pub/sub registry used by all plugin contribution maps.
 *
 * `list()` returns a stable array reference until the next mutation so
 * React `useSyncExternalStore` can compare snapshots with `Object.is`.
 */

import { type ContributionListener, Emitter } from "./emitter";

export type { ContributionListener };

export class ContributionStore<T> {
  private items = new Map<string, T>();
  private events = new Emitter("contribution");
  private snapshot: T[] = [];

  set(id: string, value: T): () => void {
    this.items.set(id, value);
    this.refreshSnapshot();
    this.emit();
    return () => {
      if (this.items.get(id) === value) {
        this.items.delete(id);
        this.refreshSnapshot();
        this.emit();
      }
    };
  }

  get(id: string): T | undefined {
    return this.items.get(id);
  }

  has(id: string): boolean {
    return this.items.has(id);
  }

  /** Stable until the next set/delete. */
  list(): T[] {
    return this.snapshot;
  }

  entries(): Array<[string, T]> {
    return Array.from(this.items.entries());
  }

  subscribe(listener: ContributionListener): () => void {
    return this.events.subscribe(listener);
  }

  private refreshSnapshot(): void {
    this.snapshot = Array.from(this.items.values());
  }

  private emit(): void {
    this.events.emit();
  }
}
