import type { WebviewToHostMessage } from "../protocol";

export interface HostApi {
  postMessage: (message: WebviewToHostMessage) => void;
}

function formatError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

/**
 * Post an error notification to the extension host. The host's `VsCodeLogger`
 * surfaces it as a native VS Code error notification via `showErrorMessage`.
 */
export function reportError(
  host: HostApi,
  scope: string,
  error: unknown,
): void {
  host.postMessage({
    type: "error",
    message: `${scope}: ${formatError(error)}`,
  });
}

/**
 * Run a promise-returning task, forwarding any rejection to the host as an
 * error notification. Use instead of `void doSomething()` so parse/IO failures
 * don't vanish into the browser's unhandled-rejection queue.
 */
export function runAsync(
  host: HostApi,
  scope: string,
  task: () => Promise<unknown>,
): void {
  task().catch((error: unknown) => {
    reportError(host, scope, error);
  });
}

/**
 * Install window-level listeners that catch anything that escapes explicit
 * try/runAsync boundaries (late shader compile failures, third-party script
 * errors) and surface them as host notifications.
 */
export function installGlobalErrorHandlers(host: HostApi): void {
  window.addEventListener("error", (event: ErrorEvent) => {
    reportError(host, "Uncaught error", event.error ?? event.message);
  });
  window.addEventListener(
    "unhandledrejection",
    (event: PromiseRejectionEvent) => {
      reportError(host, "Unhandled promise rejection", event.reason);
    },
  );
}
