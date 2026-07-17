import {
  Color3,
  Engine,
  type Mesh,
  type Scene,
  ShaderMaterial,
  Vector3,
} from "@babylonjs/core";
import type { MolvisApp } from "../app";
import {
  getImpostorMaterialSpec,
  type ImpostorMaterialSpec,
  type ImpostorTarget,
} from "./material_spec";
import type { ShadingMode } from "./representation";

// Module-level scratch vector for lighting uniform updates.
// Avoids allocating a new Vector3 on every onBind callback (~120/sec at 60fps).
const TMP_LIGHT_DIR = new Vector3();
const TMP_BACKGROUND = new Color3();

/**
 * Create the impostor shader material for atom or bond rendering.
 */
export function createImpostorMaterial(
  target: ImpostorTarget,
  scene: Scene,
  app: MolvisApp,
): ShaderMaterial {
  const spec = getImpostorMaterialSpec(target);

  const material = new ShaderMaterial(
    spec.materialName,
    scene,
    {
      vertex: spec.shaderName,
      fragment: spec.shaderName,
    },
    {
      attributes: spec.attributes,
      uniforms: spec.uniforms,
      needAlphaBlending: true,
    },
  );

  material.backFaceCulling = false;
  material.alphaMode = Engine.ALPHA_COMBINE;
  material.disableDepthWrite = false;
  material.forceDepthWrite = true;

  syncImpostorMaterialUniforms(material, scene, app);

  material.onBindObservable.add(() => {
    syncImpostorMaterialUniforms(material, scene, app);
  });

  return material;
}

export function syncImpostorMaterialUniforms(
  material: ShaderMaterial,
  scene: Scene,
  app: MolvisApp,
): void {
  material.setMatrix("view", scene.getViewMatrix());
  material.setMatrix("projection", scene.getProjectionMatrix());
  material.setFloat("uPickingEnabled", app.world.picker?.isPicking ? 1.0 : 0.0);
  const representation = app.styleManager.getRepresentation();
  TMP_BACKGROUND.set(
    scene.clearColor.r,
    scene.clearColor.g,
    scene.clearColor.b,
  );
  material.setColor3("backgroundColor", TMP_BACKGROUND);
  material.setFloat(
    "atomShadingMode",
    shadingModeValue(representation.atomShading),
  );
  material.setFloat(
    "atomOutline",
    representation.outlineEnabled ? representation.atomOutline : 0,
  );
  material.setFloat(
    "bondShadingMode",
    shadingModeValue(representation.bondShading),
  );
  material.setFloat(
    "bondOutline",
    representation.outlineEnabled ? representation.bondOutline : 0,
  );
  applyLightingUniforms(material, app);
}

function shadingModeValue(mode: ShadingMode): number {
  if (mode === "illustrative") return 1;
  if (mode === "flat") return 2;
  return 0;
}

function applyLightingUniforms(material: ShaderMaterial, app: MolvisApp): void {
  const lighting = app.settings.getLighting();
  const zDir = app.config.useRightHandedSystem
    ? -lighting.lightDir[2]
    : lighting.lightDir[2];

  TMP_LIGHT_DIR.set(lighting.lightDir[0], lighting.lightDir[1], zDir);

  material.setVector3("lightDir", TMP_LIGHT_DIR);
  material.setFloat("lightAmbient", lighting.ambient);
  material.setFloat("lightDiffuse", lighting.diffuse);
  material.setFloat("lightSpecular", lighting.specular);
  material.setFloat("lightSpecularPower", lighting.specularPower);
}

/**
 * Maximum time (ms) to wait for a shader to compile before giving up.
 */
const SHADER_COMPILE_TIMEOUT_MS = 10_000;

/**
 * Interval (ms) between readiness polls during shader warmup.
 */
const SHADER_POLL_INTERVAL_MS = 16;

/**
 * Compile a shader material against a mesh, ensuring the **instanced** variant is ready.
 *
 * BabylonJS `forceCompilationAsync` ignores the `useInstances` option for
 * non-submesh materials — it calls `isReady()` without the mesh or the flag,
 * so it compiles the non-instanced variant while we need the instanced one
 * (with `#define INSTANCES` / `#define THIN_INSTANCES`).
 *
 * Each call to `isReady(mesh, true)` triggers the engine to enqueue the
 * instanced effect for compilation if it hasn't been yet. We poll until the
 * GPU is done or the timeout fires.
 */
export function compileShaderMaterial(
  mesh: Mesh,
  material: ShaderMaterial | null,
  spec: ImpostorMaterialSpec,
): Promise<void> {
  if (!material) {
    return Promise.reject(
      new Error(`Missing shader material for ${spec.target}s`),
    );
  }

  if (material.isReady(mesh, true)) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve, reject) => {
    const start = performance.now();

    const poll = () => {
      if (material.isReady(mesh, true)) {
        resolve();
        return;
      }
      if (performance.now() - start > SHADER_COMPILE_TIMEOUT_MS) {
        const effect = material.getEffect();
        const compilationError = effect?.getCompilationError();
        const details = [
          `target=${spec.target}`,
          `shader=${spec.shaderName}`,
          `mesh=${mesh.name}`,
          `attributes=${spec.attributes.join(",")}`,
        ];
        if (compilationError) {
          details.push(`compilationError=${compilationError}`);
        }
        reject(
          new Error(
            `Shader material "${material.name}" did not compile within ${SHADER_COMPILE_TIMEOUT_MS}ms (${details.join("; ")})`,
          ),
        );
        return;
      }
      setTimeout(poll, SHADER_POLL_INTERVAL_MS);
    };

    setTimeout(poll, SHADER_POLL_INTERVAL_MS);
  });
}
