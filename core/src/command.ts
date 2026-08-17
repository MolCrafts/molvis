/**
 * Reversible operations and their undo/redo history — engine-neutral.
 *
 * The app a command acts on is a **type parameter**, not a fixed type. That is
 * the whole point: `Command` used to name `MolvisApp` directly, so anything
 * wanting a command had to depend on the 3D engine. `sketch` could not, and
 * re-implemented the same semantics locally (`SketchCommand` /
 * `SketchHistory`, whose own comment read "mirrors core CommandManager …
 * without importing core").
 *
 * Commands keep their app handle and their bodies; only the handle's type is
 * now supplied by whoever binds it.
 */

/** Emitted whenever the undo/redo stacks change. */
export interface HistoryChange {
  canUndo: boolean;
  canRedo: boolean;
}

/**
 * What {@link CommandManager} needs of its host — nothing more.
 *
 * Structural on purpose: it is satisfied by any app with an event emitter,
 * without core knowing what an app is.
 */
export interface CommandHost {
  readonly events: {
    emit(name: "history-change", payload: HistoryChange): void;
  };
}

/**
 * Anything the history can drive.
 *
 * Declared separately from {@link Command} because an app handle is a
 * convenience for subclasses, not something the history needs — `sketch`'s
 * commands capture what they edit and take no app at all.
 */
export interface Reversible<TResult = unknown> {
  do(): TResult | Promise<TResult>;
  undo(): unknown;
}

/**
 * A reversible operation bound to an app.
 *
 * `do()` performs it, `undo()` reverses it. Both may be async; the manager
 * awaits them.
 */
export abstract class Command<TApp, TResult = unknown>
  implements Reversible<TResult>
{
  protected app: TApp;

  constructor(app: TApp) {
    this.app = app;
  }

  abstract do(): TResult | Promise<TResult>;

  abstract undo():
    | Command<TApp, unknown>
    | Promise<Command<TApp, unknown>>
    | void
    | Promise<void>;
}

/** Optional debug sink; hosts pass their own logger, core stays dependency-free. */
export type CommandLog = (message: string) => void;

/**
 * Undo/redo history.
 *
 * `execute` clears the redo stack — the semantics every implementation of this
 * has copied, asserted here once.
 */
function isPromise<T>(value: T | Promise<T>): value is Promise<T> {
  return typeof (value as Promise<T>)?.then === "function";
}

export class CommandManager<TApp extends CommandHost> {
  private readonly app: TApp;
  private readonly log: CommandLog;
  private undoStack: Reversible[] = [];
  private redoStack: Reversible[] = [];

  constructor(app: TApp, log: CommandLog = () => {}) {
    this.app = app;
    this.log = log;
  }

  /**
   * Run a command, push it on the undo stack, and drop any redo history.
   *
   * **Stays synchronous for a synchronous command.** A 2D gesture handler
   * applies an edit and reads `canUndo()` in the same tick; forcing every
   * command through a microtask left the stacks briefly disagreeing with the
   * document. Callers with async commands simply `await` as before.
   */
  public execute<T>(command: Reversible<T>): T | Promise<T> {
    this.log(`Executing command: ${command.constructor.name}`);
    const result = command.do();
    if (isPromise(result)) {
      return result.then((value) => {
        this.commit(command);
        return value;
      });
    }
    this.commit(command);
    return result;
  }

  public undo(): boolean | Promise<boolean> {
    const command = this.undoStack.pop();
    if (!command) {
      this.log("Undo stack empty");
      return false;
    }
    this.log(`Undoing command: ${command.constructor.name}`);
    const reversed = command.undo();
    if (isPromise(reversed)) {
      return reversed.then(() => {
        this.settle(command, this.redoStack);
        return true;
      });
    }
    this.settle(command, this.redoStack);
    return true;
  }

  public redo(): boolean | Promise<boolean> {
    const command = this.redoStack.pop();
    if (!command) {
      this.log("Redo stack empty");
      return false;
    }
    this.log(`Redoing command: ${command.constructor.name}`);
    const result = command.do();
    if (isPromise(result)) {
      return result.then(() => {
        this.settle(command, this.undoStack);
        return true;
      });
    }
    this.settle(command, this.undoStack);
    return true;
  }

  private commit(command: Reversible<unknown>): void {
    this.undoStack.push(command);
    this.redoStack = [];
    this.emitHistoryChange();
  }

  private settle(command: Reversible<unknown>, target: Reversible[]): void {
    target.push(command);
    this.emitHistoryChange();
  }

  public clearHistory(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.emitHistoryChange();
    this.log("History cleared");
  }

  public canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  public canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  private emitHistoryChange(): void {
    this.app.events.emit("history-change", {
      canUndo: this.canUndo(),
      canRedo: this.canRedo(),
    });
  }
}
