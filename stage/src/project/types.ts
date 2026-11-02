/**
 * MolVis local project file — OVITO-style “document”, not a GPU dump.
 *
 * Reconstruction rule: **DataSource is the only molecular source of truth**.
 * The pipeline is a recipe applied on top; camera/view are view-state only.
 * Embedded frames are molrs Frame bytes (logical molrs columns), not impostor
 * buffers.
 */

import type { RepresentationStyle } from "../artist/representation";
import type { CameraPosePayload } from "../camera/control";
/** Frames inside a project are molrs Frame bytes. */
export const MOLVIS_PROJECT_FORMAT = "molvis.project" as const;

/**
 * One frame for JSON file storage: molrs Frame bytes (`writeEncodedFrame`),
 * base64-encoded, with the molrs encoding they were written in.
 */
export interface PortableFrame {
  /** molrs Frame-bytes encoding, as `readEncodedFrame` names it. */
  format: string;
  /** Base64 of the molrs Frame bytes. */
  base64: string;
}

export interface ProjectDataSourcePayload {
  /** Constructor name used on hydrate (`FileDataSource`, …). */
  typeName?: string;
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
   * Optional modifier-specific params. Empty until a modifier exposes
   * `toProjectParams()`.
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
  createdAt: string;
  /** Human label (download basename stem). */
  title?: string;
  view: ProjectViewState;
  /** Pipeline in execution order; at least one DataSource entry. */
  pipeline: ProjectPipelineEntry[];
}
