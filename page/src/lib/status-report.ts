/**
 * Lightweight status bus for UI tips that land in the canvas status overlay
 * without requiring an app reference (e.g. pipeline feedback outside the engine).
 *
 * Prefer `app.events.emit("status-message", …)` when a Molvis instance is
 * available so host bridges still see the event. This bus is the dual path for
 * React-only surfaces; {@link useStatusMessage} listens to both.
 *
 * **Log mirror:** every status line is also written via {@link createLogger}
 * → native `console.*` with the same text so the log outlives the toast.
 */

import { createLogger } from "@molcrafts/molvis-stage";

export type StatusReportType = "info" | "error" | "success" | "warning";

export interface StatusReport {
  text: string;
  type: StatusReportType;
  /** Optional 0–100 progress for long-running work. */
  progress?: number;
}

type StatusListener = (report: StatusReport) => void;

const listeners = new Set<StatusListener>();

/** Overlay twin — same text the user sees in the status toast. */
const statusLog = createLogger("molvis-status");

/** Collapse identical mirrors within a short window (bus + UI). */
let lastLogKey = "";
let lastLogAt = 0;

/** Format optional progress as a compact suffix, e.g. ` 42%`. */
export function formatProgressSuffix(progress?: number): string {
  if (progress === undefined || !Number.isFinite(progress)) return "";
  return ` ${Math.round(Math.max(0, Math.min(100, progress)))}%`;
}

/**
 * Exact status line: message + optional progress suffix.
 * Logger and the overlay must use this so they stay identical.
 */
export function formatStatusBarLine(text: string, progress?: number): string {
  return `${text.trim()}${formatProgressSuffix(progress)}`;
}

/**
 * Mirror a status-bar line to the browser console (same text as the bar).
 * error → console.error, warning → console.warn, else → console.info.
 */
export function logStatusToConsole(
  text: string,
  type: StatusReportType = "info",
  progress?: number,
  cause?: unknown,
): void {
  const line = formatStatusBarLine(text, progress);
  if (!line) return;
  const now =
    typeof performance !== "undefined" ? performance.now() : Date.now();
  const key = `${type}:${line}`;
  if (key === lastLogKey && now - lastLogAt < 80) return;
  lastLogKey = key;
  lastLogAt = now;

  if (type === "error") {
    if (cause !== undefined) statusLog.error(line, cause);
    else statusLog.error(line);
  } else if (type === "warning") {
    if (cause !== undefined) statusLog.warn(line, cause);
    else statusLog.warn(line);
  } else {
    if (cause !== undefined) statusLog.info(line, cause);
    else statusLog.info(line);
  }
}

/** Publish a one-line tip for the canvas status overlay. */
export function reportStatus(
  text: string,
  type: StatusReportType = "info",
  progress?: number,
): void {
  logStatusToConsole(text, type, progress);
  const report: StatusReport = { text, type };
  if (progress !== undefined && Number.isFinite(progress)) {
    report.progress = Math.max(0, Math.min(100, progress));
  }
  for (const listener of listeners) {
    listener(report);
  }
}

/** Subscribe to status reports. Returns an unsubscribe function. */
export function subscribeStatus(listener: StatusListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Map a viewer-operation phase to a status-bar tone. */
export function statusTypeFromPhase(
  phase: "running" | "success" | "error",
): StatusReportType {
  if (phase === "error") return "error";
  if (phase === "success") return "success";
  return "info";
}

/** Format operation feedback as a single status-bar line. */
export function formatStatusLine(message: string, detail?: string): string {
  if (detail?.trim()) return `${message} — ${detail}`;
  return message;
}
