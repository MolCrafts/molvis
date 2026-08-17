/**
 * MolVis local project file — OVITO-style “document”, not a GPU dump.
 *
 * Reconstruction rule: **DataSource is the only molecular source of truth**.
 * The pipeline is a recipe applied on top; camera/view are view-state only.
 * Binary wire frames (when embedded) are logical molrs columns, not impostor
 * buffers.
 */

import type { RepresentationStyle } from "../artist/representation";
import type { CameraPosePayload } from "../camera/control";
import type { DataSourceKind } from "../pipeline/data_source";

export const MOLVIS_PROJECT_FORMAT = "molvis.project/v1" as const;

/** One portable binary buffer (base64) referenced by wire columns. */
export interface PortableBuffer {
  /** Base64 of an ArrayBuffer (column payload). */
  base64: string;
}

/**
 * Wire frame with buffers inlined for JSON file storage.
 * Same block/column layout as RPC {@link EncodedFrame}, but buffers are
 * embedded instead of side-channel BinaryResult parts.
 */
export interface PortableFrame {
  blocks: Record<string, unknown>;
  box?: unknown;
  buffers: PortableBuffer[];
}

export interface ProjectDataSourcePayload {
  kind: DataSourceKind;
  filename: string;
  sourceType: "file" | "empty" | "backend";
  contributedBlocks: string[];
  /** Length-1+ trajectory as portable frames (required for memory DS). */
  frames: PortableFrame[];
}

export interface ProjectPipelineEntry {
  id: string;
  /**
   * Registry display name for non-DS modifiers (e.g. "Hide Hydrogens"),
   * or `"DataSource"` for any DataSource subclass.
   */
  type: string;
  enabled: boolean;
  selection_scope_id: string | null;
  source_owner_id: string | null;
  /** Present when type === "DataSource". */
  dataSource?: ProjectDataSourcePayload;
  /**
   * Optional modifier-specific params (v1: empty for most; filled when a
   * modifier exposes a stable `toProjectParams()` later).
   */
  params?: Record<string, unknown>;
}

export interface ProjectViewState {
  camera: CameraPosePayload;
  representation: RepresentationStyle;
  showBox: boolean;
}

/**
 * Full project document for local export/import (browser download / IDB).
 */
export interface MolvisProject {
  format: typeof MOLVIS_PROJECT_FORMAT;
  /** Schema bump when fields become required. */
  version: 1;
  createdAt: string;
  /** Human label (download basename stem). */
  title?: string;
  view: ProjectViewState;
  /** Pipeline in execution order; at least one DataSource entry. */
  pipeline: ProjectPipelineEntry[];
}
