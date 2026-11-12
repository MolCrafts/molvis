import {
  applyBackendState,
  type BackendStateSync,
  type Molvis,
} from "@molcrafts/molvis-stage";
import { useCallback, useEffect, useState } from "react";
import { sceneHasLoadedData } from "@/components/file-load-confirm-dialog";
import {
  formatStatusLine,
  reportStatus,
  statusTypeFromPhase,
} from "@/lib/status-report";

/**
 * Track ``backend-state-sync`` events from a fresh WS handshake.
 *
 * A blank canvas is applied silently. The controller connection is a list
 * row, not a scene, so it does not count. A canvas that already has a
 * structure or a modifier asks before it is replaced. A read-only preview
 * keeps the canvas and does not ask.
 *
 * Tips go to the bottom status bar.
 */
export interface PendingStateSync {
  state: BackendStateSync;
  summary: { nModifiers: number; nFrames: number };
}

export interface BackendStateSyncFeedback {
  phase: "running" | "success" | "error";
  message: string;
  detail?: string;
}

export interface UseBackendStateSyncResult {
  pending: PendingStateSync | null;
  /** Dialog-only apply progress/error while a conflict prompt is open. */
  feedback: BackendStateSyncFeedback | null;
  applyBackend(): Promise<void>;
  keepLocal(): void;
}

function isLocalEffectivelyEmpty(app: Molvis): boolean {
  // getEntries() includes the Session row added on connect. Counting that
  // row made every handshake look like a conflict with a blank canvas.
  return (
    app.modifierPipeline.modifiers().length === 0 && !sceneHasLoadedData(app)
  );
}

function hasIncomingState(state: BackendStateSync): boolean {
  return state.frames.length > 0 || state.pipeline.length > 0;
}

function summarizeState(state: BackendStateSync): PendingStateSync["summary"] {
  return {
    nModifiers: state.pipeline.length,
    nFrames: state.frames.length,
  };
}

function pushBar(
  phase: BackendStateSyncFeedback["phase"],
  message: string,
  detail?: string,
): void {
  reportStatus(formatStatusLine(message, detail), statusTypeFromPhase(phase));
}

export interface UseBackendStateSyncOptions {
  /** Read-only preview: never prompt; keep a non-empty canvas. */
  readonly?: boolean;
}

export function useBackendStateSync(
  app: Molvis | null,
  options: UseBackendStateSyncOptions = {},
): UseBackendStateSyncResult {
  const readonly = options.readonly === true;
  const [pending, setPending] = useState<PendingStateSync | null>(null);
  const [feedback, setFeedback] = useState<BackendStateSyncFeedback | null>(
    null,
  );

  useEffect(() => {
    if (!app) {
      setPending(null);
      setFeedback(null);
      return;
    }

    const handle = async (state: BackendStateSync) => {
      if (!hasIncomingState(state)) {
        setPending(null);
        setFeedback(null);
        return;
      }
      if (isLocalEffectivelyEmpty(app)) {
        pushBar("running", "Loading scene…");
        try {
          await applyBackendState(app, state);
          pushBar("success", "Scene loaded");
          setFeedback(null);
        } catch (err) {
          console.error("[molvis] auto-apply backend state failed:", err);
          setPending({ state, summary: summarizeState(state) });
          const detail = err instanceof Error ? err.message : String(err);
          pushBar("error", "Could not load the scene", detail);
          setFeedback({
            phase: "error",
            message: "Could not load the scene",
            detail,
          });
        }
        return;
      }
      if (readonly) {
        setPending(null);
        setFeedback(null);
        return;
      }
      setPending({
        state,
        summary: summarizeState(state),
      });
      setFeedback(null);
    };

    const off = app.events.on("backend-state-sync", (state) => {
      void handle(state);
    });
    return off;
  }, [app, readonly]);

  const applyBackend = useCallback(async () => {
    if (!app || !pending) return;
    const running: BackendStateSyncFeedback = {
      phase: "running",
      message: "Replacing scene…",
    };
    setFeedback(running);
    pushBar(running.phase, running.message);
    try {
      await applyBackendState(app, pending.state);
      setPending(null);
      setFeedback(null);
      pushBar("success", "Scene replaced");
    } catch (err) {
      console.error("[molvis] apply backend state failed:", err);
      const detail = err instanceof Error ? err.message : String(err);
      const next: BackendStateSyncFeedback = {
        phase: "error",
        message: "Could not load the scene",
        detail,
      };
      setFeedback(next);
      pushBar(next.phase, next.message, detail);
    }
  }, [app, pending]);

  const keepLocal = useCallback(() => {
    setPending(null);
    setFeedback(null);
  }, []);

  return {
    pending,
    feedback,
    applyBackend,
    keepLocal,
  };
}
