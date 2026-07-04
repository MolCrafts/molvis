import type { Box, Frame } from "@molcrafts/molrs";
import type { DatasetExploration } from "./analysis/exploration";
import type { RepresentationStyle } from "./artist/representation";
import type { ModeType } from "./mode/base";
import type { Overlay } from "./overlays/types";
import type { Trajectory } from "./system/trajectory";

/**
 * Typed event map for MolvisApp.events.
 * Every event name and its payload type is defined here.
 */
export interface MolvisEventMap {
  "frame-change": number;
  "frame-load-start": { frameId: number; requestId: number };
  "frame-load-end": { frameId: number; requestId: number; success: boolean };
  "frame-rendered": { frame: Frame; box?: Box };
  "trajectory-change": Trajectory;
  "mode-change": ModeType;
  "info-text-change": string;
  "fps-change": number;
  "history-change": { canUndo: boolean; canRedo: boolean };
  "dirty-change": boolean;
  "status-message": { text: string; type: "info" | "error" };
  "representation-change": RepresentationStyle;
  "fence-select-change": boolean;
  "pending-selection-change": { atomKeys: string[]; bondKeys: string[] };
  "overlay-added": { overlay: Overlay };
  "overlay-removed": { id: string };
  "overlay-changed": { overlay: Overlay };
  "export-requested": { format?: string };
  "backend-state-sync": BackendStateSync;
  "exploration-change": DatasetExploration | null;
  "frame-labels-change": Map<string, Float64Array> | null;
}

/**
 * Payload for ``backend-state-sync`` events — what the Python controller
 * claims the scene looked like the last time it drove the viewer, handed
 * over on a fresh WS handshake. A UI layer decides whether to silently
 * apply (local is empty) or prompt the user for a keep-local / apply-
 * backend choice.
 *
 * Frames/boxes are already decoded into WASM objects. ``pipeline`` is the
 * raw modifier metadata in execution order; the first entry is expected to
 * be the DataSource and is usually rebuilt by `applyBackendState` rather
 * than re-created directly.
 */
export interface BackendStateSyncPipelineEntry {
  id: string;
  name: string;
  capabilities: string[];
  enabled: boolean;
  parent_id: string | null;
  /** DataSourceModifier-only fields (multi-DS spec phase 4). Present
   *  for entries whose `name` is "Data Source"; ignored otherwise. */
  kind?: "trajectory" | "frame";
  filename?: string;
  source_type?: "file" | "empty" | "backend";
  contributed_blocks?: string[];
}

export interface BackendStateSync {
  pipeline: BackendStateSyncPipelineEntry[];
  frames: Frame[];
  boxes: (Box | undefined)[];
}

export type Listener<T = unknown> = (data: T) => void;

/**
 * Type-safe event emitter.
 *
 * When instantiated as EventEmitter<MolvisEventMap>, all emit/on/off calls
 * are checked against the event map at compile time.
 */
export class EventEmitter<TMap = Record<string, unknown>> {
  private listeners = new Map<string, Set<Listener<unknown>>>();

  public on<K extends string & keyof TMap>(
    event: K,
    listener: Listener<TMap[K]>,
  ): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)?.add(listener as Listener<unknown>);

    return () => this.off(event, listener);
  }

  public off<K extends string & keyof TMap>(
    event: K,
    listener: Listener<TMap[K]>,
  ): void {
    const listeners = this.listeners.get(event);
    if (listeners) {
      listeners.delete(listener as Listener<unknown>);
      if (listeners.size === 0) {
        this.listeners.delete(event);
      }
    }
  }

  public emit<K extends string & keyof TMap>(event: K, data: TMap[K]): void {
    const listeners = this.listeners.get(event);
    if (listeners) {
      for (const listener of new Set(listeners)) {
        (listener as Listener<TMap[K]>)(data);
      }
    }
  }

  public clear(): void {
    this.listeners.clear();
  }
}
