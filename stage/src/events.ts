import type { AppEventMap } from "@molcrafts/molvis-core/events";
import { EventEmitter } from "@molcrafts/molvis-core/events";
import type { Box, Frame } from "@molcrafts/molvis-core/molrs";
import type { DatasetExploration } from "./analysis/exploration";
import type { RepresentationStyle } from "./artist/representation";
import type { ModeId } from "./mode/mode_type";
import type { Overlay } from "./overlays/types";
import type { Trajectory } from "./system/trajectory";

/**
 * Typed event map for MolvisApp.events.
 * Every event name and its payload type is defined here.
 */
export interface MolvisEventMap extends AppEventMap {
  "frame-change": number;
  "frame-load-start": { frameId: number; requestId: number };
  "frame-load-end": { frameId: number; requestId: number; success: boolean };
  "frame-rendered": { frame: Frame; box?: Box };
  "trajectory-change": Trajectory;
  "mode-change": ModeId;
  "info-text-change": string;
  "fps-change": number;
  "show-fps-change": boolean;
  "dirty-change": boolean;
  "status-message": {
    text: string;
    type: "info" | "error" | "success" | "warning";
    /** Optional 0–100 for long-running work (optimize, analysis, …). */
    progress?: number;
  };
  "representation-change": RepresentationStyle;
  "fence-select-change": boolean;
  /**
   * Which selection producer is active in Select mode (list row).
   * `null` = no active region; highlight should be empty.
   */
  "active-selection-change": { id: string | null };
  "pending-selection-change": {
    atomKeys: string[];
    bondKeys: string[];
    atomCount: number;
    bondCount: number;
  };
  "overlay-added": { overlay: Overlay };
  "overlay-removed": { id: string };
  "overlay-changed": { overlay: Overlay };
  "export-requested": { format?: string };
  "backend-state-sync": BackendStateSync;
  "exploration-change": DatasetExploration | null;
  "frame-labels-change": Map<string, Float64Array> | null;
  "analysis-progress": {
    runId: string;
    completed: number;
    total: number;
    frameIndex: number;
  };
  "analysis-complete": { runId: string; result: unknown };
  "analysis-error": { runId: string; error: Error; frameIndex?: number };
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
  /** Pipeline category label (e.g. Data Source). Preferred DS discriminator. */
  category?: string;
  capabilities: string[];
  enabled: boolean;
  selection_scope_id: string | null;
  source_owner_id: string | null;
  /**
   * DataSource acquisition kind (`file` | `memory` | …) when serialized from
   * core, or legacy multi-DS labels (`trajectory` | `frame`). Presence or
   * `category === "Data Source"` identifies a data source entry.
   */
  kind?: string;
  filename?: string;
  source_type?: "file" | "empty" | "backend";
  contributed_blocks?: string[];
}

export interface BackendStateSync {
  pipeline: BackendStateSyncPipelineEntry[];
  frames: Frame[];
  boxes: (Box | undefined)[];
}

export type { AppEventMap, Listener } from "@molcrafts/molvis-core/events";
export { EventEmitter };
