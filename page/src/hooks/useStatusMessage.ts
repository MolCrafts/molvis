import type { Molvis } from "@molcrafts/molvis-stage";
import { useEffect, useRef } from "react";
import { subscribeStatus } from "@/lib/status-report";

/**
 * Bridge page-level status sources into the stage `status-message` stream
 * so the stage StatusPanel can render them.
 *
 * Sources: the page status bus (`reportStatus`), frame-load / compute
 * progress, and global browser errors. The bridge emits `status-message` on
 * the app; it renders nothing itself.
 */
export function useStatusMessage(app: Molvis | null): void {
  /** Active compute run id while progress events are streaming. */
  const analysisRunRef = useRef<string | null>(null);

  useEffect(() => {
    const handleGlobalError = (event: ErrorEvent) => {
      console.error(
        "[molvis] window error",
        event.error ?? event.message,
        event,
      );
      app?.events.emit("status-message", {
        text: `Error: ${event.message}`,
        type: "error",
      });
    };

    const handleRejection = (event: PromiseRejectionEvent) => {
      console.error("[molvis] unhandledrejection", event.reason);
      let msg = "Unknown error";
      if (event.reason instanceof Error) {
        msg = event.reason.message;
      } else if (typeof event.reason === "string") {
        msg = event.reason;
      }
      app?.events.emit("status-message", {
        text: `Async Error: ${msg}`,
        type: "error",
      });
    };

    window.addEventListener("error", handleGlobalError);
    window.addEventListener("unhandledrejection", handleRejection);

    return () => {
      window.removeEventListener("error", handleGlobalError);
      window.removeEventListener("unhandledrejection", handleRejection);
    };
  }, [app]);

  useEffect(() => {
    return subscribeStatus(({ text, type, progress }) => {
      app?.events.emit("status-message", { text, type, progress });
    });
  }, [app]);

  useEffect(() => {
    if (!app) return;

    const handleFrameLoadStart = (payload: {
      frameId: number;
      requestId: number;
    }) => {
      app.events.emit("status-message", {
        text: `Loading frame ${payload.frameId + 1}…`,
        type: "info",
      });
    };

    const handleFrameLoadEnd = (payload: {
      frameId: number;
      requestId: number;
      success: boolean;
    }) => {
      if (!payload.success) {
        app.events.emit("status-message", {
          text: `Failed to load frame ${payload.frameId + 1}`,
          type: "error",
        });
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
      app.events.emit("status-message", {
        text: base,
        type: "info",
        progress: pct,
      });
    };

    const handleAnalysisComplete = (payload: { runId: string }) => {
      if (
        analysisRunRef.current !== null &&
        analysisRunRef.current !== payload.runId
      ) {
        return;
      }
      analysisRunRef.current = null;
      app.events.emit("status-message", {
        text: "Compute complete",
        type: "success",
      });
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
      app.events.emit("status-message", {
        text: `Compute failed${payload.frameIndex !== undefined ? ` at frame ${payload.frameIndex + 1}` : ""}: ${payload.error.message}`,
        type: "error",
      });
    };

    app.events.on("frame-load-start", handleFrameLoadStart);
    app.events.on("frame-load-end", handleFrameLoadEnd);
    app.events.on("analysis-progress", handleAnalysisProgress);
    app.events.on("analysis-complete", handleAnalysisComplete);
    app.events.on("analysis-error", handleAnalysisError);

    return () => {
      app.events.off("frame-load-start", handleFrameLoadStart);
      app.events.off("frame-load-end", handleFrameLoadEnd);
      app.events.off("analysis-progress", handleAnalysisProgress);
      app.events.off("analysis-complete", handleAnalysisComplete);
      app.events.off("analysis-error", handleAnalysisError);
    };
  }, [app]);
}
