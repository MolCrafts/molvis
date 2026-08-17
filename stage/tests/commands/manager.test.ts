import { describe, expect, it } from "@rstest/core";
import type { MolvisApp } from "../../src/app";
import { Command } from "../../src/commands/base";
import { CommandManager } from "../../src/commands/manager";
import { EventEmitter, type MolvisEventMap } from "../../src/events";

// Minimal mock app with events
function mockApp(): MolvisApp {
  const events = new EventEmitter<MolvisEventMap>();
  return { events } as MolvisApp;
}

// Simple test command that tracks do/undo calls
class TestCommand extends Command<string> {
  doCount: number;
  undoCount: number;
  constructor(app: MolvisApp) {
    super(app);
    this.doCount = 0;
    this.undoCount = 0;
  }
  async do(): Promise<string> {
    this.doCount++;
    return "done";
  }
  async undo(): Promise<Command> {
    this.undoCount++;
    return this;
  }
}

describe("CommandManager", () => {
  it("execute should call do() and return result", async () => {
    const app = mockApp();
    const mgr = new CommandManager(app);
    const cmd = new TestCommand(app);

    const result = await mgr.execute(cmd);
    expect(result).toBe("done");
    expect(cmd.doCount).toBe(1);
  });

  it("execute should push command onto undo stack", async () => {
    const app = mockApp();
    const mgr = new CommandManager(app);
    expect(mgr.canUndo()).toBe(false);

    await mgr.execute(new TestCommand(app));
    expect(mgr.canUndo()).toBe(true);
  });

  it("undo should call undo() on the last command", async () => {
    const app = mockApp();
    const mgr = new CommandManager(app);
    const cmd = new TestCommand(app);

    await mgr.execute(cmd);
    const result = await mgr.undo();
    expect(result).toBe(true);
    expect(cmd.undoCount).toBe(1);
  });

  it("undo should return false when stack is empty", async () => {
    const app = mockApp();
    const mgr = new CommandManager(app);
    const result = await mgr.undo();
    expect(result).toBe(false);
  });

  it("redo should call do() on the undone command", async () => {
    const app = mockApp();
    const mgr = new CommandManager(app);
    const cmd = new TestCommand(app);

    await mgr.execute(cmd);
    await mgr.undo();
    expect(mgr.canRedo()).toBe(true);

    const result = await mgr.redo();
    expect(result).toBe(true);
    expect(cmd.doCount).toBe(2); // initial do + redo
  });

  it("redo should return false when stack is empty", async () => {
    const app = mockApp();
    const mgr = new CommandManager(app);
    const result = await mgr.redo();
    expect(result).toBe(false);
  });

  it("execute should clear redo stack", async () => {
    const app = mockApp();
    const mgr = new CommandManager(app);

    await mgr.execute(new TestCommand(app));
    await mgr.undo();
    expect(mgr.canRedo()).toBe(true);

    // New execute clears redo
    await mgr.execute(new TestCommand(app));
    expect(mgr.canRedo()).toBe(false);
  });

  it("clearHistory should empty both stacks", async () => {
    const app = mockApp();
    const mgr = new CommandManager(app);

    await mgr.execute(new TestCommand(app));
    await mgr.execute(new TestCommand(app));
    await mgr.undo();
    expect(mgr.canUndo()).toBe(true);
    expect(mgr.canRedo()).toBe(true);

    mgr.clearHistory();
    expect(mgr.canUndo()).toBe(false);
    expect(mgr.canRedo()).toBe(false);
  });

  it("should emit history-change events", async () => {
    const app = mockApp();
    const mgr = new CommandManager(app);
    const history: { canUndo: boolean; canRedo: boolean }[] = [];
    app.events.on("history-change", (h) => history.push(h));

    await mgr.execute(new TestCommand(app));
    expect(history[history.length - 1]).toEqual({
      canUndo: true,
      canRedo: false,
    });

    await mgr.undo();
    expect(history[history.length - 1]).toEqual({
      canUndo: false,
      canRedo: true,
    });

    await mgr.redo();
    expect(history[history.length - 1]).toEqual({
      canUndo: true,
      canRedo: false,
    });
  });

  it("multiple undo/redo should maintain correct order", async () => {
    const app = mockApp();
    const mgr = new CommandManager(app);
    const cmds = [
      new TestCommand(app),
      new TestCommand(app),
      new TestCommand(app),
    ];

    for (const cmd of cmds) {
      await mgr.execute(cmd);
    }

    // Undo all
    await mgr.undo();
    await mgr.undo();
    await mgr.undo();
    expect(mgr.canUndo()).toBe(false);
    expect(mgr.canRedo()).toBe(true);

    // Undo counts: each command undone once
    expect(cmds[0].undoCount).toBe(1);
    expect(cmds[1].undoCount).toBe(1);
    expect(cmds[2].undoCount).toBe(1);
  });
});
