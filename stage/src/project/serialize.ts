/**
 * Snapshot a live app into a {@link MolvisProject} document.
 *
 * Molecular data is taken **only** from DataSource modifiers (each source's
 * trajectory). Edit working tree that is not yet committed is not included —
 * call {@link MolvisApp.commitScene} first if that content must be saved.
 */

import type { MolvisApp } from "../app";
import { readCameraPose } from "../camera/control";
import { DataSource } from "../pipeline/data_source";
import type { Modifier } from "../pipeline/modifier";
import { frameToPortable } from "./portable_frame";
import {
  MOLVIS_PROJECT_FORMAT,
  type MolvisProject,
  type ProjectDataSourcePayload,
  type ProjectPipelineEntry,
} from "./types";

async function captureDataSource(
  ds: DataSource,
): Promise<ProjectDataSourcePayload> {
  const n = ds.frameCount;
  const frames = [];
  for (let i = 0; i < n; i++) {
    await ds.preload(i);
    const frame = ds.cachedFrame;
    frames.push(frameToPortable(frame));
  }
  return {
    kind: ds.kind,
    filename: ds.filename,
    sourceType: ds.sourceType,
    contributedBlocks: [...ds.contributedBlocks],
    frames,
  };
}

function pipelineTypeName(mod: {
  name: string;
  constructor: { name: string };
}): string {
  // Registry uses human names ("Hide Hydrogens"); prefer that for hydrate.
  return mod.name;
}

/**
 * Build a project snapshot from the current committed pipeline + view.
 */
export async function serializeProject(
  app: MolvisApp,
  options?: { title?: string },
): Promise<MolvisProject> {
  const entries = app.modifierPipeline.getEntries();
  const pipeline: ProjectPipelineEntry[] = [];

  for (const entry of entries) {
    if (entry instanceof DataSource) {
      const dataSource = await captureDataSource(entry);
      pipeline.push({
        id: entry.id,
        type: "DataSource",
        enabled: entry.enabled,
        // A source consumes no selection and is owned by nothing; the keys
        // stay in the format so every row has the same shape on the wire.
        selection_scope_id: null,
        source_owner_id: null,
        dataSource,
      });
      continue;
    }

    const mod = entry as Modifier;
    pipeline.push({
      id: mod.id,
      type: pipelineTypeName(mod),
      enabled: mod.enabled,
      selection_scope_id: mod.selectionScopeId,
      source_owner_id: mod.sourceOwnerId,
    });
  }

  const hasDs = pipeline.some((e) => e.type === "DataSource");
  if (!hasDs) {
    throw new Error(
      "serializeProject: pipeline has no DataSource — single-path invariant broken",
    );
  }

  const camera = readCameraPose(app.world.camera);
  const representation = app.styleManager.getRepresentation();
  const showBox = app.styleManager.getShowBox();

  return {
    format: MOLVIS_PROJECT_FORMAT,
    version: 1,
    createdAt: new Date().toISOString(),
    title: options?.title,
    view: {
      camera,
      representation,
      showBox,
    },
    pipeline,
  };
}

/** JSON string for download / IDB (pretty-printed). */
export async function serializeProjectJson(
  app: MolvisApp,
  options?: { title?: string },
): Promise<string> {
  const project = await serializeProject(app, options);
  return `${JSON.stringify(project, null, 2)}\n`;
}

/** Type guard for imported JSON. */
export function isMolvisProject(value: unknown): value is MolvisProject {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    v.format === MOLVIS_PROJECT_FORMAT &&
    v.version === 1 &&
    Array.isArray(v.pipeline) &&
    v.view !== null &&
    typeof v.view === "object"
  );
}
