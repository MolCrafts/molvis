import type { App, History } from "@molcrafts/molvis-core/app";
import type { AppEventMap, EventEmitter } from "@molcrafts/molvis-core/events";
import type { SketchBoard } from "./board/sketch_board";

/**
 * The 2D sketch editor as an {@link App}.
 *
 * `stage` and `sketch` are two apps over one abstraction: both announce state
 * on an event emitter and both keep a reversible history. What differs is the
 * domain model (`System` vs `MoleculeGraph`) and the renderer — neither is in
 * the shared interface.
 *
 * A thin owner rather than a rewrite: `SketchBoard` already holds the graph,
 * the history and the emitter; this exposes them under the shared names so
 * hosts can treat either engine the same way.
 */
export class SketchApp implements App {
  constructor(private readonly board: SketchBoard) {}

  get events(): EventEmitter<AppEventMap> {
    return this.board.events;
  }

  get commandManager(): History {
    return this.board.history;
  }

  /** The engine-specific surface, for callers that need the 2D editor itself. */
  get sketch(): SketchBoard {
    return this.board;
  }

  stop(): void {
    this.board.setDisabled(true);
  }

  /**
   * `SketchBoard` has no teardown of its own yet, so this releases what the
   * app layer owns — history and listeners — and disables the board. Give the
   * board a `dispose()` and delegate here once it has one.
   */
  destroy(): void {
    this.stop();
    this.board.history.clearHistory();
    this.board.events.clear();
  }
}
