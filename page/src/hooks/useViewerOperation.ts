import { useCallback, useEffect, useRef, useState } from "react";
import type { ViewerOperationPhase } from "@/components/viewer/ViewerOperationState";
import { formatStatusLine, logStatusToConsole } from "@/lib/status-report";

export interface ViewerOperationFeedback {
  phase: Extract<ViewerOperationPhase, "running" | "success" | "error">;
  message: string;
  detail?: string;
}

export interface ViewerOperationCopy {
  running: string;
  success: string;
  error: string;
  runningDetail?: string;
  successDetail?: string;
}

export interface ViewerOperationOptions {
  /** Let React paint the running state before synchronous work begins. */
  paintRunning?: boolean;
  /** Clear successful feedback after this delay; omit to keep it visible. */
  successDurationMs?: number;
  /** Omit routine running/success callouts while still surfacing failures. */
  feedbackMode?: "all" | "errors";
}

export type ViewerOperationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: unknown };

interface LastOperation {
  task: () => unknown | Promise<unknown>;
  copy: ViewerOperationCopy;
  options: ViewerOperationOptions;
}

function afterNextPaint(): Promise<void> {
  if (typeof requestAnimationFrame === "undefined") return Promise.resolve();
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (typeof error === "object" &&
      error !== null &&
      "name" in error &&
      error.name === "AbortError")
  );
}

/** Local async-operation state machine with observable synchronous work. */
export function useViewerOperation() {
  const [feedback, setFeedback] = useState<ViewerOperationFeedback | null>(
    null,
  );
  const [running, setRunning] = useState(false);
  const runningRef = useRef(false);
  const mountedRef = useRef(true);
  const generationRef = useRef(0);
  const successTimerRef = useRef<number | null>(null);
  const lastOperationRef = useRef<LastOperation | null>(null);

  const clearSuccessTimer = useCallback(() => {
    if (successTimerRef.current !== null) {
      window.clearTimeout(successTimerRef.current);
      successTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      generationRef.current += 1;
      runningRef.current = false;
      clearSuccessTimer();
    };
  }, [clearSuccessTimer]);

  const reset = useCallback(() => {
    clearSuccessTimer();
    setFeedback(null);
  }, [clearSuccessTimer]);

  const run = useCallback(
    async <T>(
      task: () => T | Promise<T>,
      copy: ViewerOperationCopy,
      options: ViewerOperationOptions = {},
    ): Promise<ViewerOperationResult<T>> => {
      if (runningRef.current) {
        return {
          ok: false,
          error: new Error("Another viewer operation is already running"),
        };
      }

      clearSuccessTimer();
      const generation = ++generationRef.current;
      runningRef.current = true;
      setRunning(true);
      if (options.feedbackMode === "errors") {
        setFeedback(null);
      } else {
        setFeedback({
          phase: "running",
          message: copy.running,
          detail: copy.runningDetail,
        });
      }
      lastOperationRef.current = {
        task,
        copy,
        options,
      } as LastOperation;

      if (options.paintRunning !== false) {
        await afterNextPaint();
      }

      try {
        if (!mountedRef.current || generation !== generationRef.current) {
          throw new DOMException("Viewer operation cancelled", "AbortError");
        }
        const value = await task();
        if (
          mountedRef.current &&
          generation === generationRef.current &&
          options.feedbackMode !== "errors"
        ) {
          setFeedback({
            phase: "success",
            message: copy.success,
            detail: copy.successDetail,
          });
          if (options.successDurationMs) {
            successTimerRef.current = window.setTimeout(() => {
              setFeedback(null);
              successTimerRef.current = null;
            }, options.successDurationMs);
          }
        }
        return { ok: true, value };
      } catch (error) {
        if (isAbortError(error)) {
          if (mountedRef.current && generation === generationRef.current) {
            setFeedback(null);
          }
          return { ok: false, error };
        }
        if (mountedRef.current && generation === generationRef.current) {
          // Prefer Error.message; wasm-bindgen often throws raw strings —
          // String(error) keeps the molrs parse line/section text.
          const detail =
            error instanceof Error
              ? error.message
              : typeof error === "string"
                ? error
                : String(error);
          // Same line as the status bar; attach the Error for stack traces.
          logStatusToConsole(
            formatStatusLine(copy.error, detail),
            "error",
            undefined,
            error,
          );
          setFeedback({
            phase: "error",
            message: copy.error,
            detail,
          });
        }
        return { ok: false, error };
      } finally {
        if (generation === generationRef.current) {
          runningRef.current = false;
          if (mountedRef.current) setRunning(false);
        }
      }
    },
    [clearSuccessTimer],
  );

  const retry = useCallback(async () => {
    const last = lastOperationRef.current;
    if (!last) return;
    await run(last.task, last.copy, last.options);
  }, [run]);

  return { feedback, running, run, retry, reset };
}
