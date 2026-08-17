import {
  applyBackendState,
  type BackendStateSync,
  DataSource,
  type Molvis,
} from "@molcrafts/molvis-stage";
import { useCallback, useEffect, useState } from "react";
import {
  formatStatusLine,
  reportStatus,
  statusTypeFromPhase,
} from "@/lib/status-report";

/**
 * Track ``backend-state-sync`` events emitted when the Python controller
 * finishes a fresh WS handshake and hands over its mirror of the scene.
 *
 * If the local pipeline is effectively empty (no modifiers, or only the
 * ``sourceType === "empty"`` demo seed the page ships with), we apply
 * the backend snapshot silently. Otherwise we surface the pending
 * snapshot so the UI can prompt the user to keep local or use the
 * backend.
 *
 * Operation tips always go to the bottom status bar (never floating cards).
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
  const modifiers = app.modifierPipeline.getEntries();
  if (modifiers.length === 0) return true;
  if (modifiers.length === 1) {
    const only = modifiers[0];
    if (only instanceof DataSource && only.sourceType === "empty") {
      return true;
    }
  }
  return false;
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

export function useBackendStateSync(
  app: Molvis | null,
): UseBackendStateSyncResult {
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
        pushBar("running", "Applying backend state…");
        try {
          await applyBackendState(app, state);
          pushBar(
            "success",
            "Backend state applied",
            "The molecular scene now matches the Python controller.",
          );
          setFeedback(null);
        } catch (err) {
          console.error("[molvis] auto-apply backend state failed:", err);
          setPending({ state, summary: summarizeState(state) });
          const detail = err instanceof Error ? err.message : String(err);
          pushBar("error", "Backend state could not be applied", detail);
          setFeedback({
            phase: "error",
            message: "Backend state could not be applied",
            detail,
          });
        }
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
  }, [app]);

  const applyBackend = useCallback(async () => {
    if (!app || !pending) return;
    const running: BackendStateSyncFeedback = {
      phase: "running",
      message: "Applying backend state…",
    };
    setFeedback(running);
    pushBar(running.phase, running.message);
    try {
      await applyBackendState(app, pending.state);
      setPending(null);
      setFeedback(null);
      pushBar(
        "success",
        "Backend state applied",
        "The local scene was replaced by the Python controller state.",
      );
    } catch (err) {
      console.error("[molvis] apply backend state failed:", err);
      const detail = err instanceof Error ? err.message : String(err);
      const next: BackendStateSyncFeedback = {
        phase: "error",
        message: "Backend state could not be applied",
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
