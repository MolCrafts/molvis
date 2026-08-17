import { describe, expect, it } from "@rstest/core";
import type { MolvisApp } from "../../src/app";
import { Command } from "../../src/commands/base";
import { CompositeCommand } from "../../src/commands/composite";

/**
 * Test suite for Command System
 */
describe("Command System", () => {
  describe("Command Base", () => {
    it("should create a command with app instance", () => {
      const mockApp = {} as MolvisApp;
      // `Command.app` is protected; a subclass is the only legitimate reader,
      // which is exactly how every real command reaches it.
      const command = new (class extends Command<void> {
        do(): void {}
        undo(): void {}
        get boundApp(): MolvisApp {
          return this.app;
        }
      })(mockApp);

      expect(command).toBeDefined();
      expect(command.boundApp).toBe(mockApp);
    });
  });

  describe("CompositeCommand", () => {
    it("should execute multiple commands in sequence", async () => {
      const mockApp = {} as MolvisApp;
      const executionOrder: number[] = [];

      class TestCommand extends Command<void> {
        constructor(
          app: MolvisApp,
          private id: number,
        ) {
          super(app);
        }

        async do(): Promise<void> {
          executionOrder.push(this.id);
        }

        async undo(): Promise<void> {
          executionOrder.push(-this.id);
        }
      }

      const cmd1 = new TestCommand(mockApp, 1);
      const cmd2 = new TestCommand(mockApp, 2);
      const cmd3 = new TestCommand(mockApp, 3);

      const composite = new CompositeCommand(mockApp, [cmd1, cmd2, cmd3]);

      await composite.do();

      expect(executionOrder).toEqual([1, 2, 3]);
    });

    it("should undo commands in reverse order", async () => {
      const mockApp = {} as MolvisApp;
      const executionOrder: number[] = [];

      class TestCommand extends Command<void> {
        constructor(
          app: MolvisApp,
          private id: number,
        ) {
          super(app);
        }

        async do(): Promise<void> {
          executionOrder.push(this.id);
        }

        async undo(): Promise<void> {
          executionOrder.push(-this.id);
        }
      }

      const cmd1 = new TestCommand(mockApp, 1);
      const cmd2 = new TestCommand(mockApp, 2);

      const composite = new CompositeCommand(mockApp, [cmd1, cmd2]);

      await composite.do();
      executionOrder.length = 0; // Clear array

      await composite.undo();

      expect(executionOrder).toEqual([-2, -1]);
    });
  });
});
