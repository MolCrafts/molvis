import type { MolvisApp } from "../app";

/**
 * Command function type that operates on MolvisApp.
 * Commands can be synchronous or asynchronous and may return values for RPC responses.
 */
export type CommandFn<A = unknown, R = unknown> = (
  app: MolvisApp,
  args: A,
) => R | Promise<R>;

/**
 * CommandRegistry manages command registration and execution.
 *
 * Commands are functions that operate on MolvisApp and modify pipelines or app state.
 * They should NOT implicitly compute or render - those steps are triggered explicitly by the caller.
 */
export class CommandRegistry {
  private commands = new Map<string, CommandFn<unknown, unknown>>();

  /**
   * Register a command function.
   * @param name Command name
   * @param fn Command function
   */
  register<A, R>(name: string, fn: CommandFn<A, R>): CommandFn<A, R> {
    if (!name || typeof name !== "string") {
      throw new Error("Command name must be a non-empty string");
    }
    if (typeof fn !== "function") {
      throw new Error("Command must be a function");
    }
    this.commands.set(name, fn as CommandFn<unknown, unknown>);
    return fn;
  }

  /**
   * Execute a command by name.
   * @param name Command name
   * @param app MolvisApp instance
   * @param args Command arguments
   * @returns Promise if command is async, void otherwise
   */
  execute<A, R = unknown>(
    name: string,
    app: MolvisApp,
    args: A,
  ): R | Promise<R> {
    const fn = this.commands.get(name) as CommandFn<A, R> | undefined;
    if (!fn) {
      throw new Error(`Unknown command: ${name}`);
    }
    return fn(app, args);
  }

  /**
   * Check if a command is registered.
   */
  has(name: string): boolean {
    return this.commands.has(name);
  }

  /**
   * Get all registered command names.
   */
  list(): string[] {
    return Array.from(this.commands.keys()).sort();
  }

  /**
   * Remove a command.
   */
  unregister(name: string): void {
    this.commands.delete(name);
  }
}

/**
 * Global commands singleton - the primary public API for command registration.
 */
export const commands = new CommandRegistry();
