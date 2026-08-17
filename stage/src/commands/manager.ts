import { CommandManager as CoreCommandManager } from "@molcrafts/molvis-core/command";
import type { MolvisApp } from "../app";
import { createLogger } from "../utils/logger";

const logger = createLogger("CommandManager");

/**
 * Stage's binding of the engine-neutral history in
 * `@molcrafts/molvis-core/command`: fixes the app type and supplies a logger.
 */
export class CommandManager extends CoreCommandManager<MolvisApp> {
  constructor(app: MolvisApp) {
    super(app, (message) => logger.debug(message));
  }
}
