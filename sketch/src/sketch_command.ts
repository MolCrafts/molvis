import type { Reversible } from "@molcrafts/molvis-core/command";

/**
 * A reversible sketch edit.
 *
 * Sketch commands capture what they edit, so they take no app handle — they
 * satisfy core's {@link Reversible} rather than extending `Command<TApp>`.
 * The undo/redo history itself is core's `CommandManager`; this package used
 * to carry a copy of it.
 */
export abstract class SketchCommand implements Reversible<void> {
  /** Apply the edit. */
  abstract do(): void;
  /** Reverse the edit. */
  abstract undo(): void;
}
