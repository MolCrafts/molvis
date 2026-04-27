/**
 * Commands module — Command pattern for MolVis operations.
 *
 * All commands extend Command<T> with do()/undo(). The `@command(name)`
 * decorator on a class body registers the class into the global `commands`
 * registry as a *module-load side effect*.
 *
 * ⚠️  Tree-shaking trap (read before touching):
 * When `page/` bundles core from source via alias, the bundler treats every
 * source file as side-effect-free (core's package.json `sideEffects` glob
 * never matches `./src/**`). Bare `import "./foo"` side-effect imports get
 * dead-code-eliminated → `@command` decorator never runs → command vanishes
 * at runtime with `Unknown command: xxx`.
 *
 * The fix below is to name-import every decorated class and pin them all
 * into `REGISTERED_COMMAND_CLASSES`. `registerDefaultCommands()` then reads
 * that array — a live, observable use — which pulls each module into the
 * reachability graph and forces the bundler to evaluate it (running the
 * decorator along the way).
 *
 * Adding a new `@command(...)` class? Import it below AND add it to
 * `REGISTERED_COMMAND_CLASSES`. Do not rely on `import "./foo"` tricks.
 */

// Core command infrastructure
export { Command, command, getCommandMetadata } from "./base";
export { commands, CommandRegistry } from "./registry";
export type { CommandFn } from "./registry";

import { SetAttributeCommand, SetFrameMetaCommand } from "./attributes";
import { ClearSceneCommand } from "./clear";
// ── Name-imports: load every @command-decorated class so its decorator runs.
//    These are NOT optional — removing one silently breaks the command at
//    runtime (see header comment).
import {
  DeleteAtomCommand,
  DeleteBondCommand,
  DrawAtomCommand,
  DrawBondCommand,
} from "./draw";
import { ExportFrameCommand, NewFrameCommand } from "./frame";
import {
  MarkAtomCommand,
  RemarkAtomCommand,
  UnmarkAtomCommand,
} from "./mark_atom";
import {
  AddOverlayCommand,
  AddOverlaySnapshotCommand,
  RemoveOverlayCommand,
  UpdateOverlayCommand,
} from "./overlays";
import { SetRepresentationCommand } from "./representation";
import { SelectAtomByIdCommand, getSelectedCommand } from "./selection";
import { TakeSnapshotCommand } from "./snapshot";

// Re-export for downstream consumers.
export {
  DrawAtomCommand,
  DeleteAtomCommand,
  DrawBondCommand,
  DeleteBondCommand,
  ClearSceneCommand,
  getSelectedCommand,
  SelectAtomByIdCommand,
  SetAttributeCommand,
  SetFrameMetaCommand,
  NewFrameCommand,
  ExportFrameCommand,
  TakeSnapshotCommand,
  SetRepresentationCommand,
  AddOverlayCommand,
  RemoveOverlayCommand,
  UpdateOverlayCommand,
  AddOverlaySnapshotCommand,
  MarkAtomCommand,
  UnmarkAtomCommand,
  RemarkAtomCommand,
};

export type { GetSelectedResponse } from "../selection_manager";

// Public types
export type { DrawFrameOption } from "./draw";

/**
 * Every class whose registration depends on `@command(...)` firing at
 * module-load time. This array exists purely to pin those class references
 * into the reachability graph — without it, bundlers drop modules that are
 * re-exported but never imported by name elsewhere (mark_atom, clear,
 * snapshot, attributes, etc.), and their decorators never execute.
 *
 * `RemarkAtomCommand` has no `@command` decorator but lives in the same
 * module as `MarkAtomCommand`; including its sibling above is enough to
 * keep the file alive, so it is not listed here.
 */
const REGISTERED_COMMAND_CLASSES = [
  DrawAtomCommand,
  DeleteAtomCommand,
  DrawBondCommand,
  DeleteBondCommand,
  ClearSceneCommand,
  SelectAtomByIdCommand,
  SetAttributeCommand,
  SetFrameMetaCommand,
  NewFrameCommand,
  ExportFrameCommand,
  TakeSnapshotCommand,
  SetRepresentationCommand,
  AddOverlayCommand,
  RemoveOverlayCommand,
  UpdateOverlayCommand,
  AddOverlaySnapshotCommand,
  MarkAtomCommand,
  UnmarkAtomCommand,
] as const;

/**
 * Ensure the default command set is registered with the global `commands`
 * registry. The `@command` decorators above already fired at import time;
 * this function's sole job is to read `REGISTERED_COMMAND_CLASSES.length`
 * so bundlers can see the array is live, which forces them to retain the
 * imports and, transitively, execute each decorator. The return value is
 * incidental — callers consume it for the side effect.
 */
export function registerDefaultCommands(): number {
  return REGISTERED_COMMAND_CLASSES.length;
}
