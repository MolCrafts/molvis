import { describe, expect, it } from "@rstest/core";
import type { MolvisApp } from "../../src/app";
import {
  CameraAnimateCommand,
  registerDefaultCommands,
} from "../../src/commands";
import { commands } from "../../src/commands/registry";

/**
 * animate_camera is a transient, RPC-exposed command: it must register with
 * the global registry, and its undo() must return `this` (it never enters the
 * undo history — mirrors TakeSnapshotCommand).
 */
describe("animate_camera command (ac-014)", () => {
  it("registers with the global command registry", () => {
    registerDefaultCommands();
    expect(commands.has("animate_camera")).toBe(true);
  });

  it("undo() returns the command instance (transient)", () => {
    const cmd = new CameraAnimateCommand({} as MolvisApp, {});
    expect(cmd.undo()).toBe(cmd);
  });
});
