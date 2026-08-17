/**
 * Type-safe event emitter — engine-neutral.
 *
 * The emitter itself never knew anything about 3D; it only lived in `stage`
 * because that is where the app lived. Anything that wants to announce state
 * changes (an app, a board, a manager) can now use it without pulling in the
 * renderer.
 */

export type Listener<T = unknown> = (data: T) => void;

/**
 * Events every app announces, whatever it renders.
 *
 * Engines extend this with their own map; `history-change` is here because
 * `CommandManager` — also core's — emits it.
 */
export interface AppEventMap {
  "history-change": { canUndo: boolean; canRedo: boolean };
}

/**
 * Instantiate with an event map and every `on` / `off` / `emit` is checked
 * against it at compile time.
 */
export class EventEmitter<TMap = Record<string, unknown>> {
  private listeners = new Map<string, Set<Listener<unknown>>>();

  /** Subscribe; the returned function unsubscribes. */
  public on<K extends string & keyof TMap>(
    event: K,
    listener: Listener<TMap[K]>,
  ): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)?.add(listener as Listener<unknown>);

    return () => this.off(event, listener);
  }

  public off<K extends string & keyof TMap>(
    event: K,
    listener: Listener<TMap[K]>,
  ): void {
    const listeners = this.listeners.get(event);
    if (listeners) {
      listeners.delete(listener as Listener<unknown>);
      if (listeners.size === 0) {
        this.listeners.delete(event);
      }
    }
  }

  /** Iterates a copy, so a listener may unsubscribe during dispatch. */
  public emit<K extends string & keyof TMap>(event: K, data: TMap[K]): void {
    const listeners = this.listeners.get(event);
    if (listeners) {
      for (const listener of new Set(listeners)) {
        (listener as Listener<TMap[K]>)(data);
      }
    }
  }

  public clear(): void {
    this.listeners.clear();
  }
}
