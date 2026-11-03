/**
 * Rebuild a scene from a {@link MolvisProject}: DataSources first, then
 * non-DS modifiers from the registry, then view state.
 */

import { Frame } from "@molcrafts/molvis-core/molrs";
import type { MolvisApp } from "../app";
import { setCameraPose } from "../camera/control";
import {
  type DataSource,
  FileDataSource,
  MemoryDataSource,
} from "../pipeline/data_source";
import { DrawSurfaceModifier } from "../pipeline/draw_surface";
import { bootstrapEmptyPipeline } from "../pipeline/empty_scene";
import { ModifierRegistry } from "../pipeline/modifier_registry";
import { Trajectory } from "../system/trajectory";
import { carriesProjectParams } from "./params";
import { portableToFrame } from "./portable_frame";
import { isMolvisProject } from "./serialize";
import type { MolvisProject, ProjectPipelineEntry } from "./types";

function factoryByRegistryName(typeName: string) {
  ModifierRegistry.initialize();
  const entry = ModifierRegistry.getAvailableModifiers().find(
    (e) => e.name === typeName,
  );
  return entry?.factory;
}

/**
 * Replace the current scene with a project document.
 *
 * Clears the pipeline, rebuilds every DataSource from embedded frames
 * (MemoryDataSource / FileDataSource trajectory — **sole molecular truth**),
 * re-adds known modifiers by registry name, then restores camera / style.
 */
export async function hydrateProject(
  app: MolvisApp,
  project: MolvisProject,
): Promise<void> {
  if (!isMolvisProject(project)) {
    throw new Error("hydrateProject: invalid molvis.project document");
  }

  bootstrapEmptyPipeline(app.system, app.modifierPipeline);

  const idMap = new Map<string, string>();
  const dsEntries = project.pipeline.filter((e) => e.type === "DataSource");
  const otherEntries = project.pipeline.filter((e) => e.type !== "DataSource");

  if (dsEntries.length === 0) {
    // Empty project → empty pipeline (user opens a Source).
  } else {
    let first = true;
    for (const entry of dsEntries) {
      const ds = materializeDataSource(entry);
      if (first) {
        app.system.trajectory = ds.trajectory;
        app.modifierPipeline.addSource(ds);
        first = false;
      } else {
        await app.addDataSource(ds);
      }
      idMap.set(entry.id, ds.id);
    }
  }

  for (const entry of otherEntries) {
    const factory = factoryByRegistryName(entry.type);
    if (!factory) {
      console.warn(
        `[molvis.project] no factory for modifier "${entry.type}" — skipping`,
      );
      continue;
    }
    const mod = factory();
    mod.enabled = entry.enabled;
    if (
      typeof entry.params?.highlightColor === "string" &&
      /^#[0-9a-fA-F]{6}$/.test(entry.params.highlightColor)
    ) {
      mod.highlightColor = entry.params.highlightColor;
    }
    if (carriesProjectParams(mod) && entry.params) {
      mod.fromProjectParams(entry.params);
    }
    if (entry.selection_scope_id) {
      mod.selectionScopeId =
        idMap.get(entry.selection_scope_id) ?? entry.selection_scope_id;
    }
    if (entry.source_owner_id) {
      mod.sourceOwnerId =
        idMap.get(entry.source_owner_id) ?? entry.source_owner_id;
    }
    // The saved pipeline already contains each producer's Draw surface, so
    // pairing here would add a second one on every load.
    if (mod instanceof DrawSurfaceModifier && mod.producerId) {
      mod.producerId = idMap.get(mod.producerId) ?? mod.producerId;
    }
    app.modifierPipeline.addModifier(mod, { attachDraw: false });
    idMap.set(entry.id, mod.id);
  }

  await app.applyPipeline({ fullRebuild: true });

  if (project.view?.representation) {
    app.styleManager.setRepresentation(project.view.representation);
  }
  if (typeof project.view?.showBox === "boolean") {
    app.styleManager.setShowBox(project.view.showBox);
  }
  if (project.view?.camera) {
    const c = project.view.camera;
    setCameraPose(app.world.camera, {
      alpha: c.alpha,
      beta: c.beta,
      radius: c.radius,
      target: [...c.target],
    });
  }
}

function materializeDataSource(entry: ProjectPipelineEntry): DataSource {
  const payload = entry.dataSource;
  if (!payload || payload.frames.length === 0) {
    return new MemoryDataSource(new Frame(), {
      filename: payload?.filename ?? "Empty Scene",
      sourceType: payload?.sourceType ?? "empty",
      contributedBlocks: payload?.contributedBlocks,
    });
  }

  const frames = payload.frames.map((pf, i) =>
    portableToFrame(pf, `project.dataSource[${entry.id}].frames[${i}]`),
  );

  if (payload.typeName === "FileDataSource" || frames.length > 1) {
    const traj = new Trajectory(frames);
    return new FileDataSource(traj, {
      filename: payload.filename || "trajectory",
      sourceType: payload.sourceType === "file" ? "file" : "backend",
      contributedBlocks: payload.contributedBlocks,
    });
  }

  return new MemoryDataSource(frames[0], {
    filename: payload.filename || "Scene",
    sourceType: payload.sourceType === "empty" ? "backend" : payload.sourceType,
    contributedBlocks: payload.contributedBlocks,
  });
}
