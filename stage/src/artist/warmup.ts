import {
  type Mesh,
  MeshBuilder,
  type Scene,
  type ShaderMaterial,
} from "@babylonjs/core";
import type { ImpostorMaterialSpec } from "./material_spec";

/**
 * Create a temporary warmup mesh with minimal instance buffers.
 * Used to trigger shader compilation without polluting the real renderer meshes.
 */
export function createWarmupMesh(
  name: string,
  scene: Scene,
  material: ShaderMaterial,
  spec: ImpostorMaterialSpec,
): Mesh {
  const mesh = MeshBuilder.CreatePlane(name, { size: 1.0 }, scene);
  mesh.material = material;
  mesh.isPickable = false;
  mesh.isVisible = false;

  const matrix = new Float32Array(16);
  matrix[0] = 1;
  matrix[5] = 1;
  matrix[10] = 1;
  matrix[15] = 1;
  mesh.thinInstanceSetBuffer("matrix", matrix, 16, false);

  for (const buffer of spec.warmupBuffers) {
    mesh.thinInstanceSetBuffer(buffer.name, buffer.data, buffer.stride, false);
  }

  mesh.thinInstanceCount = 1;
  return mesh;
}
