import { describe, expect, it } from "@rstest/core";
import {
  Command,
  type CommandHost,
  CommandManager,
  type HistoryChange,
} from "../src/command";

/** Minimal host: the emitter is all CommandManager asks for. */
class FakeHost implements CommandHost {
  readonly changes: HistoryChange[] = [];
  readonly events = {
    emit: (_name: "history-change", payload: HistoryChange) => {
      this.changes.push(payload);
    },
  };
}

/** Records the order of do/undo so tests can assert the sequence. */
class Append extends Command<FakeHost, string> {
  constructor(
    host: FakeHost,
    private readonly tag: string,
    private readonly trace: string[],
  ) {
    super(host);
  }
  do(): string {
    this.trace.push(`do:${this.tag}`);
    return this.tag;
  }
  undo(): void {
    this.trace.push(`undo:${this.tag}`);
  }
}

describe("CommandManager history", () => {
  it("returns the command's result from execute", async () => {
    const host = new FakeHost();
    const mgr = new CommandManager(host);
    expect(await mgr.execute(new Append(host, "a", []))).toBe("a");
  });

  it("undoes in reverse order", async () => {
    const host = new FakeHost();
    const mgr = new CommandManager(host);
    const trace: string[] = [];
    await mgr.execute(new Append(host, "a", trace));
    await mgr.execute(new Append(host, "b", trace));
    await mgr.undo();
    await mgr.undo();
    expect(trace).toEqual(["do:a", "do:b", "undo:b", "undo:a"]);
  });

  it("replays an undone command on redo", async () => {
    const host = new FakeHost();
    const mgr = new CommandManager(host);
    const trace: string[] = [];
    await mgr.execute(new Append(host, "a", trace));
    await mgr.undo();
    await mgr.redo();
    expect(trace).toEqual(["do:a", "undo:a", "do:a"]);
  });

  it("clears the redo stack when a new command is executed", async () => {
    // The rule every local re-implementation copied by hand.
    const host = new FakeHost();
    const mgr = new CommandManager(host);
    await mgr.execute(new Append(host, "a", []));
    await mgr.undo();
    expect(mgr.canRedo()).toBe(true);
    await mgr.execute(new Append(host, "b", []));
    expect(mgr.canRedo()).toBe(false);
  });

  it("reports false when there is nothing to undo or redo", async () => {
    const mgr = new CommandManager(new FakeHost());
    expect(await mgr.undo()).toBe(false);
    expect(await mgr.redo()).toBe(false);
  });

  it("empties both stacks on clearHistory", async () => {
    const host = new FakeHost();
    const mgr = new CommandManager(host);
    await mgr.execute(new Append(host, "a", []));
    await mgr.undo();
    mgr.clearHistory();
    expect(mgr.canUndo()).toBe(false);
    expect(mgr.canRedo()).toBe(false);
  });

  it("announces every history change to its host", async () => {
    const host = new FakeHost();
    const mgr = new CommandManager(host);
    await mgr.execute(new Append(host, "a", []));
    await mgr.undo();
    expect(host.changes).toEqual([
      { canUndo: true, canRedo: false },
      { canUndo: false, canRedo: true },
    ]);
  });

  it("awaits an async command before pushing it", async () => {
    const host = new FakeHost();
    const mgr = new CommandManager(host);
    let settled = false;
    class Slow extends Command<FakeHost, number> {
      async do(): Promise<number> {
        await Promise.resolve();
        settled = true;
        return 7;
      }
      undo(): void {}
    }
    expect(await mgr.execute(new Slow(host))).toBe(7);
    expect(settled).toBe(true);
    expect(mgr.canUndo()).toBe(true);
  });
});
