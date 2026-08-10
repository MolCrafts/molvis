/**
 * Frontend logger — thin `console` wrappers. No tslog.
 *
 * Every call is a real browser console sink so DevTools (and host webviews)
 * always show errors/warnings. Debug/silly stay quiet outside development.
 */

export type LogArgs = unknown[];

export interface MolvisLogger {
  silly: (...args: LogArgs) => void;
  trace: (...args: LogArgs) => void;
  debug: (...args: LogArgs) => void;
  info: (...args: LogArgs) => void;
  warn: (...args: LogArgs) => void;
  error: (...args: LogArgs) => void;
  fatal: (...args: LogArgs) => void;
}

function resolveNodeEnv(): string | undefined {
  const maybeGlobal = globalThis as typeof globalThis & {
    process?: { env?: { NODE_ENV?: string } };
  };
  return maybeGlobal.process?.env?.NODE_ENV;
}

function isDev(): boolean {
  return resolveNodeEnv() === "development";
}

function hasConsole(): boolean {
  return typeof console !== "undefined";
}

/**
 * Create a named logger. Methods mirror the old tslog surface so call sites
 * keep working: `logger.info(…)`, `logger.error(msg, err)`, etc.
 */
export function createLogger(name: string): MolvisLogger {
  const tag = `[${name}]`;

  const debug = (...args: LogArgs): void => {
    if (!isDev() || !hasConsole()) return;
    console.debug(tag, ...args);
  };

  return {
    silly: debug,
    trace: debug,
    debug,
    info: (...args: LogArgs): void => {
      if (!hasConsole()) return;
      console.info(tag, ...args);
    },
    warn: (...args: LogArgs): void => {
      if (!hasConsole()) return;
      console.warn(tag, ...args);
    },
    error: (...args: LogArgs): void => {
      if (!hasConsole()) return;
      console.error(tag, ...args);
    },
    fatal: (...args: LogArgs): void => {
      if (!hasConsole()) return;
      console.error(tag, ...args);
    },
  };
}

/** Default stage logger. */
export const logger = createLogger("molvis-stage");
