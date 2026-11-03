import type { Molvis } from "@molcrafts/molvis-stage";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  formatStatusBarLine,
  logStatusToConsole,
  type StatusReportType,
  subscribeStatus,
} from "@/lib/status-report";

/** How long info/success activity stays before the left region goes blank. */
const AUTO_CLEAR_MS = 5000;

export interface StatusActivity {
  /** Empty when idle — no "Ready" placeholder. */
  text: string;
  type: StatusReportType;
  /** Optional 0–100 for long-running work. */
  progress?: number;
  /** Monotonic key so the bar can re-pulse on repeated identical messages. */
  pulse: number;
}

/**
 * Activity feed for the canvas status overlay.
 *
 * Sources: page status bus, `status-message` events, frame-load / compute
 * progress, and global browser errors. Idle is blank (never "Ready").
 * Warnings and errors stay until {@link dismissActivity} (or a new report).
 */
export function useStatusMessage(app: Molvis | null): {
  activity: StatusActivity;
  dismissActivity: () => void;
} {
  const [text, setText] = useState("");
  const [type, setType] = useState<StatusReportType>("info");
  const [progress, setProgress] = useState<number | undefined>(undefined);
  const [pulse, setPulse] = useState(0);
  const statusResetTimer = useRef<number | null>(null);
  /** Active compute run id while progress events are streaming. */
  const analysisRunRef = useRef<string | null>(null);

  const clearTimer = useCallback(() => {
    if (statusResetTimer.current) {
      window.clearTimeout(statusResetTimer.current);
      statusResetTimer.current = null;
    }
  }, []);

  const clearActivity = useCallback(() => {
    clearTimer();
    setText("");
    setType("info");
    setProgress(undefined);
  }, [clearTimer]);

  const applyStatus = useCallback(
    (
      nextText: string,
      nextType: StatusReportType,
      nextProgress?: number,
      /** When false, skip console (already logged by reportStatus / stage). */
      mirrorConsole = true,
    ) => {
      const trimmed = nextText.trim();
      if (!trimmed) {
        clearActivity();
        return;
      }

      // Same string the bar shows (message + optional ` 42%`).
      if (mirrorConsole) {
        logStatusToConsole(trimmed, nextType, nextProgress);
      }

      setText(trimmed);
      setType(nextType);
      setProgress(nextProgress);
      setPulse((n) => n + 1);
      clearTimer();

      // Success tips auto-clear. Long-running **info** lines (optimize, load)
      // stay until replaced — otherwise "Starting optimization…" vanished
      // after 5s while the worker was still silent, looking dead.
      if (nextType === "success" && nextProgress === undefined) {
        statusResetTimer.current = window.setTimeout(() => {
          setText("");
          setType("info");
          setProgress(undefined);
          statusResetTimer.current = null;
        }, AUTO_CLEAR_MS);
      }
    },
    [clearActivity, clearTimer],
  );

  const dismissActivity = useCallback(() => {
    clearActivity();
  }, [clearActivity]);

  useEffect(() => {
    const handleGlobalError = (event: ErrorEvent) => {
      // Native sink first — the status toast must not be the only record.
      console.error(
        "[molvis] window error",
        event.error ?? event.message,
        event,
      );
      const line = `Error: ${event.message}`;
      logStatusToConsole(line, "error", undefined, event.error);
      applyStatus(line, "error", undefined, false);
    };

    const handleRejection = (event: PromiseRejectionEvent) => {
      // Do not preventDefault — Chrome would then hide the rejection.
      console.error("[molvis] unhandledrejection", event.reason);
      let msg = "Unknown error";
      if (event.reason instanceof Error) {
        msg = event.reason.message;
      } else if (typeof event.reason === "string") {
        msg = event.reason;
      }
      const line = `Async Error: ${msg}`;
      logStatusToConsole(line, "error", undefined, event.reason);
      applyStatus(line, "error", undefined, false);
    };

    window.addEventListener("error", handleGlobalError);
    window.addEventListener("unhandledrejection", handleRejection);

    return () => {
      window.removeEventListener("error", handleGlobalError);
      window.removeEventListener("unhandledrejection", handleRejection);
    };
  }, [applyStatus]);

  useEffect(() => {
    return subscribeStatus(({ text: next, type: nextType, progress: p }) => {
      // reportStatus already mirrored to console — avoid a second line.
      applyStatus(next, nextType, p, false);
    });
  }, [applyStatus]);

  useEffect(() => {
    if (!app) {
      clearActivity();
      return;
    }

    const handleStatus = (event: {
      text: string;
      type: "info" | "error" | "success" | "warning";
      progress?: number;
    }) => {
      // App already logs status-message via stage logger → console. Only
      // re-mirror errors/warnings so a red bar always has a DevTools twin if
      // the app path was skipped.
      const mirrorConsole = event.type === "error" || event.type === "warning";
      applyStatus(event.text, event.type, event.progress, mirrorConsole);
    };

    const handleFrameLoadStart = (payload: {
      frameId: number;
      requestId: number;
    }) => {
      applyStatus(`Loading frame ${payload.frameId + 1}…`, "info");
    };

    const handleFrameLoadEnd = (payload: {
      frameId: number;
      requestId: number;
      success: boolean;
    }) => {
      if (payload.success) {
        // Don't spam the bar on every scrub; only clear a prior load line.
        setText((current) =>
          current.startsWith("Loading frame") ? "" : current,
        );
        setProgress(undefined);
      } else {
        applyStatus(`Failed to load frame ${payload.frameId + 1}`, "error");
      }
    };

    const handleAnalysisProgress = (payload: {
      runId: string;
      completed: number;
      total: number;
      frameIndex: number;
    }) => {
      analysisRunRef.current = payload.runId;
      const pct =
        payload.total > 0
          ? Math.round((payload.completed / payload.total) * 100)
          : undefined;
      const base =
        payload.total > 0
          ? `Analyzing frame ${payload.frameIndex + 1} (${payload.completed}/${payload.total})`
          : `Analyzing frame ${payload.frameIndex + 1}…`;
      applyStatus(base, "info", pct);
    };

    const handleAnalysisComplete = (payload: { runId: string }) => {
      if (
        analysisRunRef.current !== null &&
        analysisRunRef.current !== payload.runId
      ) {
        return;
      }
      analysisRunRef.current = null;
      applyStatus("Compute complete", "success");
    };

    const handleAnalysisError = (payload: {
      runId: string;
      error: Error;
      frameIndex?: number;
    }) => {
      if (
        analysisRunRef.current !== null &&
        analysisRunRef.current !== payload.runId
      ) {
        return;
      }
      analysisRunRef.current = null;
      applyStatus(
        `Compute failed${payload.frameIndex !== undefined ? ` at frame ${payload.frameIndex + 1}` : ""}: ${payload.error.message}`,
        "error",
      );
    };

    app.events.on("status-message", handleStatus);
    app.events.on("frame-load-start", handleFrameLoadStart);
    app.events.on("frame-load-end", handleFrameLoadEnd);
    app.events.on("analysis-progress", handleAnalysisProgress);
    app.events.on("analysis-complete", handleAnalysisComplete);
    app.events.on("analysis-error", handleAnalysisError);

    return () => {
      app.events.off("status-message", handleStatus);
      app.events.off("frame-load-start", handleFrameLoadStart);
      app.events.off("frame-load-end", handleFrameLoadEnd);
      app.events.off("analysis-progress", handleAnalysisProgress);
      app.events.off("analysis-complete", handleAnalysisComplete);
      app.events.off("analysis-error", handleAnalysisError);
      clearTimer();
    };
  }, [app, applyStatus, clearActivity, clearTimer]);

  return {
    activity: {
      text: text ? formatStatusBarLine(text, progress) : "",
      type,
      progress,
      pulse,
    },
    dismissActivity,
  };
}
