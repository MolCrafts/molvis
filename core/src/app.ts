/**
 * What every MolVis app is, whatever it renders.
 *
 * `stage` (3D) and `sketch` (2D) are two implementations. The interface holds
 * only what is genuinely shared and what consumers actually read — the
 * renderer (`world`, `canvas`, `artist`, `styleManager`, `modifierPipeline`)
 * and each engine's domain model (`System` vs `MoleculeGraph`) stay with the
 * engine that owns them.
 *
 * `Settings` is deliberately absent: it carries Babylon references in `stage`,
 * so sinking it would drag the renderer into core.
 */

import type { AppEventMap, EventEmitter } from "./events";

/**
 * Undo/redo surface an app exposes.
 *
 * Declared structurally rather than as `CommandManager<Self>`: a generic class
 * parameterised by the concrete app is invariant, so no two apps could share
 * one declaration. `CommandManager` satisfies this by construction.
 */
export interface History {
  /**
   * Returns synchronously for a synchronous command; callers may `await`
   * either way. A 2D gesture handler depends on the synchronous path.
   */
  execute<T>(command: {
    do(): T | Promise<T>;
    undo(): unknown;
  }): T | Promise<T>;
  undo(): boolean | Promise<boolean>;
  redo(): boolean | Promise<boolean>;
  clearHistory(): void;
  canUndo(): boolean;
  canRedo(): boolean;
}

export interface App {
  /** State changes an app announces; engines extend {@link AppEventMap}. */
  readonly events: EventEmitter<AppEventMap>;

  /** Reversible operation history. */
  readonly commandManager: History;

  /** Stop rendering / listening, keeping the instance reusable. */
  stop(): void;

  /** Release everything; the instance is not reusable afterwards. */
  destroy(): void;
}
