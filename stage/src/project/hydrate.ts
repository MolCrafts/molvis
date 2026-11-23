/**
 * Rebuild a scene from a {@link MolvisProject}: DataSources first, then
 * non-DS modifiers from the registry, then view state.
 */

import { Vector3 } from "@babylonjs/core";
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
import type { ProjectPipelineEntry } from "./types";
import { ProjectView } from "./view";

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
  project: unknown,
): Promise<void> {
  if (!isMolvisProject(project)) {
    throw new Error("hydrateProject: invalid molvis.project document");
  }

  const view = new ProjectView(project.view, project.version === 1);
  // Prepare data before replacing the current scene, including invalid frame payloads.
  const preparedSources = project.pipeline
    .filter((entry) => entry.type === "DataSource")
    .map((entry) => ({ entry, ds: materializeDataSource(entry) }));

  bootstrapEmptyPipeline(app.system, app.modifierPipeline);
  app.styleManager.setRepresentation(view.representation);
  app.styleManager.setMaterial("atom", view.materials.atom);
  app.styleManager.setMaterial("bond", view.materials.bond);
  app.styleManager.setCategoricalTheme(view.coloring.categoricalTheme);
  app.styleManager.setBondColorMode(view.coloring.bondColorMode);
  app.styleManager.setShowBox(view.showBox);
  app.settings.setLighting(view.lighting);
  app.settings.setEffects(view.effects);
  app.setBackgroundColor(view.background);
  app.world.camera.upVector = new Vector3(...view.camera.up);
  setCameraPose(app.world.camera, view.camera);

  const idMap = new Map<string, string>();
  const dsEntries = project.pipeline.filter((e) => e.type === "DataSource");
  const otherEntries = project.pipeline.filter((e) => e.type !== "DataSource");

  if (dsEntries.length === 0) {
    // Empty project → empty pipeline (user opens a Source).
  } else {
    let first = true;
    for (const { entry, ds } of preparedSources) {
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

  app.events.emit("representation-change", view.representation);
  app.events.emit("material-change", view.materials);
  app.events.emit("coloring-change", undefined);
  app.world.renderOnce();
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
