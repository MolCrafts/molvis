import {
  applyBackendState,
  type BackendStateSync,
  DataSourceModifier,
  type Molvis,
} from "@molvis/core";
import { useCallback, useEffect, useState } from "react";

/**
 * Track ``backend-state-sync`` events emitted when the Python controller
 * finishes a fresh WS handshake and hands over its mirror of the scene.
 *
 * If the local pipeline is effectively empty (no modifiers, or only the
 * ``sourceType === "empty"`` demo seed the page ships with), we apply
 * the backend snapshot silently. Otherwise we surface the pending
 * snapshot so the UI can prompt the user to keep local or use the
 * backend.
 */
export interface PendingStateSync {
  state: BackendStateSync;
  summary: { nModifiers: number; nFrames: number };
}

export interface UseBackendStateSyncResult {
  pending: PendingStateSync | null;
  applyBackend(): Promise<void>;
  keepLocal(): void;
}

function isLocalEffectivelyEmpty(app: Molvis): boolean {
  const modifiers = app.modifierPipeline.getModifiers();
  if (modifiers.length === 0) return true;
  if (modifiers.length === 1) {
    const only = modifiers[0];
    if (only instanceof DataSourceModifier && only.sourceType === "empty") {
      return true;
    }
  }
  return false;
}

function hasIncomingState(state: BackendStateSync): boolean {
  return state.frames.length > 0 || state.pipeline.length > 0;
}

export function useBackendStateSync(
  app: Molvis | null,
): UseBackendStateSyncResult {
  const [pending, setPending] = useState<PendingStateSync | null>(null);

  useEffect(() => {
    if (!app) return;

    const handle = async (state: BackendStateSync) => {
      if (!hasIncomingState(state)) {
        setPending(null);
        return;
      }
      if (isLocalEffectivelyEmpty(app)) {
        try {
          await applyBackendState(app, state);
        } catch (err) {
          console.error("[molvis] auto-apply backend state failed:", err);
        }
        return;
      }
      setPending({
        state,
        summary: {
          nModifiers: state.pipeline.length,
          nFrames: state.frames.length,
        },
      });
    };

    const off = app.events.on("backend-state-sync", (state) => {
      void handle(state);
    });
    return off;
  }, [app]);

  const applyBackend = useCallback(async () => {
    if (!app || !pending) return;
    try {
      await applyBackendState(app, pending.state);
    } catch (err) {
      console.error("[molvis] apply backend state failed:", err);
    } finally {
      setPending(null);
    }
  }, [app, pending]);

  const keepLocal = useCallback(() => {
    setPending(null);
  }, []);

  return { pending, applyBackend, keepLocal };
}
