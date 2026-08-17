import {
  Color3,
  type LinesMesh,
  MeshBuilder,
  type Scene,
  Vector3,
} from "@babylonjs/core";
import { SliceModifier } from "../modifiers/SliceModifier";
import type { ModifierPipeline } from "../pipeline";

const GUIDE_MESH_NAME = "visual_guide_mesh";

/**
 * Find the active SliceModifier in the pipeline, if any.
 */
export function findSliceModifier(
  pipeline: ModifierPipeline,
): SliceModifier | null {
  for (const mod of pipeline.modifiers()) {
    if (mod instanceof SliceModifier && mod.enabled) return mod;
  }
  return null;
}

/**
 * Update the visual guide wireframe mesh from the SliceModifier's guideLines.
 * Disposes the old mesh and creates a new one if guide lines are present.
 */
export function updateVisualGuide(
  scene: Scene,
  sliceMod: SliceModifier | null,
): void {
  const existing = scene.getMeshByName(GUIDE_MESH_NAME) as LinesMesh | null;

  if (!sliceMod || sliceMod.guideLines.length === 0) {
    if (existing) existing.dispose();
    return;
  }

  const lines: Vector3[][] = [];
  for (const guide of sliceMod.guideLines) {
    lines.push(guide.points.map(([x, y, z]) => new Vector3(x, y, z)));
  }

  if (existing) existing.dispose();
  const guideMesh = MeshBuilder.CreateLineSystem(
    GUIDE_MESH_NAME,
    { lines },
    scene,
  );
  guideMesh.color = new Color3(1, 0, 0);
  guideMesh.renderingGroupId = 1;
  guideMesh.isPickable = false;
}
