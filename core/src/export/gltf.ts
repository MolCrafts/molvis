import {
  Color3,
  type Engine,
  Mesh,
  MeshBuilder,
  PBRMetallicRoughnessMaterial,
  Quaternion,
  Scene,
  Vector3,
} from "@babylonjs/core";
import type { Frame } from "@molcrafts/molrs";
import { buildAtomBuffers } from "../artist/atom_buffer";
import { buildBondBuffers } from "../artist/bond_buffer";
import { StyleManager } from "../artist/style_manager";

/**
 * Options for {@link exportFrameToGLB}. Defaults produce a matte, OVITO-style
 * ball-and-stick model that renders identically in any glTF viewer.
 */
export interface GltfExportOptions {
  /** PBR roughness. High = matte (default 0.9). */
  roughness?: number;
  /** PBR metalness (default 0). */
  metallic?: number;
  /** Latitude/longitude segments per atom sphere (default 16). */
  sphereSegments?: number;
  /** Radial tessellation per bond cylinder (default 12). */
  bondTessellation?: number;
  /**
   * Reuse an existing StyleManager (so exported colours/radii match the live
   * scene's theme and representation). Defaults to a fresh ClassicTheme manager.
   */
  styleManager?: StyleManager;
}

const UP = Vector3.Up();

/**
 * Serialize a molecular {@link Frame} to a self-contained binary glTF (.glb).
 *
 * Geometry and colours come from molvis's own render buffers
 * ({@link buildAtomBuffers} / {@link buildBondBuffers}) — the exported model is
 * the same ball-and-stick the engine draws, just as real triangle meshes
 * instead of GPU impostors. Atoms occlude the buried ends of bonds through
 * ordinary opaque depth; bond halves are split-coloured by their end atoms.
 *
 * Runs headless: it only needs a Babylon `Engine` (a `NullEngine` is fine) —
 * no canvas, WebGL, or render loop. The `@babylonjs/serializers` module is
 * loaded lazily so it stays out of the main bundle (mirrors the inspector).
 *
 * @param frame  Frame carrying an `"atoms"` block (and optionally a `"bonds"` block).
 * @param engine Babylon engine used to host the throwaway export scene.
 * @returns The `.glb` file as bytes.
 */
export async function exportFrameToGLB(
  frame: Frame,
  engine: Engine,
  options?: GltfExportOptions,
): Promise<Uint8Array> {
  const atomsBlock = frame.getBlock("atoms");
  if (!atomsBlock || atomsBlock.nrows() === 0) {
    throw new Error("exportFrameToGLB: frame has no atoms to export");
  }

  const roughness = options?.roughness ?? 0.9;
  const metallic = options?.metallic ?? 0;
  const sphereSegments = options?.sphereSegments ?? 16;
  const bondTessellation = options?.bondTessellation ?? 12;

  const scene = new Scene(engine);
  try {
    const styleManager = options?.styleManager ?? new StyleManager(scene);

    // Colour groups: one merged mesh + one material per distinct RGB. Molecular
    // scenes have only a handful of element colours, so this stays tiny and
    // needs no glTF extensions to render everywhere.
    const groups = new Map<string, { color: Color3; meshes: Mesh[] }>();
    const addToGroup = (mesh: Mesh, r: number, g: number, b: number): void => {
      const key = `${Math.round(r * 4096)},${Math.round(g * 4096)},${Math.round(b * 4096)}`;
      let group = groups.get(key);
      if (!group) {
        group = { color: new Color3(r, g, b), meshes: [] };
        groups.set(key, group);
      }
      group.meshes.push(mesh);
    };

    // Atoms → spheres. instanceData = [x, y, z, radius]; instanceColor = linear RGBA.
    const atomBuffers = buildAtomBuffers(atomsBlock, styleManager, 0);
    const atomData = atomBuffers.get("instanceData");
    const atomColor = atomBuffers.get("instanceColor");
    if (!atomData || !atomColor) {
      throw new Error(
        "exportFrameToGLB: atom buffers missing expected columns",
      );
    }
    const atomCount = atomsBlock.nrows();
    for (let i = 0; i < atomCount; i++) {
      const o = i * 4;
      const radius = atomData[o + 3];
      if (radius <= 0) continue;
      const sphere = MeshBuilder.CreateSphere(
        `atom${i}`,
        { diameter: radius * 2, segments: sphereSegments },
        scene,
      );
      sphere.position.set(atomData[o], atomData[o + 1], atomData[o + 2]);
      addToGroup(sphere, atomColor[o], atomColor[o + 1], atomColor[o + 2]);
    }

    // Bonds → two split-coloured half cylinders per (sub-)bond instance.
    const bondsBlock = frame.getBlock("bonds");
    if (bondsBlock && bondsBlock.nrows() > 0) {
      const bond = buildBondBuffers(bondsBlock, atomsBlock, atomColor, 0, {
        radius: styleManager.getBondStyle(1).radius,
      });
      if (bond) {
        const d0 = bond.buffers.get("instanceData0");
        const d1 = bond.buffers.get("instanceData1");
        const c0 = bond.buffers.get("instanceColor0");
        const c1 = bond.buffers.get("instanceColor1");
        if (d0 && d1 && c0 && c1) {
          for (let k = 0; k < bond.instanceCount; k++) {
            const o = k * 4;
            const radius = d0[o + 3];
            if (radius <= 0) continue;
            const center = new Vector3(d0[o], d0[o + 1], d0[o + 2]);
            const half = new Vector3(d1[o], d1[o + 1], d1[o + 2]).scale(
              d1[o + 3] * 0.5,
            );
            const p0 = center.subtract(half); // end at atom of colour0
            const p1 = center.add(half); // end at atom of colour1
            addCylinder(scene, p0, center, radius, bondTessellation, (m) =>
              addToGroup(m, c0[o], c0[o + 1], c0[o + 2]),
            );
            addCylinder(scene, center, p1, radius, bondTessellation, (m) =>
              addToGroup(m, c1[o], c1[o + 1], c1[o + 2]),
            );
          }
        }
      }
    }

    // Merge each colour group and give it one matte PBR material.
    let materialIndex = 0;
    for (const group of groups.values()) {
      const merged = Mesh.MergeMeshes(
        group.meshes,
        true, // dispose sources
        true, // allow 32-bit indices (scenes exceed 65k verts fast)
        undefined,
        false,
        false,
      );
      if (!merged) continue;
      const mat = new PBRMetallicRoughnessMaterial(
        `mat${materialIndex++}`,
        scene,
      );
      mat.baseColor = group.color; // already linear, matching glTF baseColorFactor
      mat.metallic = metallic;
      mat.roughness = roughness;
      merged.material = mat;
    }

    const { GLTF2Export } = await import("@babylonjs/serializers");
    const data = await GLTF2Export.GLBAsync(scene, "molecule");
    const blob = data.files["molecule.glb"] as Blob;
    return new Uint8Array(await blob.arrayBuffer());
  } finally {
    scene.dispose();
  }
}

/**
 * Add a capped cylinder spanning `from`→`to` (Babylon cylinders are Y-aligned
 * and centred, so we place the midpoint and rotate +Y onto the bond axis).
 */
function addCylinder(
  scene: Scene,
  from: Vector3,
  to: Vector3,
  radius: number,
  tessellation: number,
  register: (mesh: Mesh) => void,
): void {
  const axis = to.subtract(from);
  const height = axis.length();
  if (height < 1e-6) return;
  const cyl = MeshBuilder.CreateCylinder(
    "bond",
    { height, diameter: radius * 2, tessellation, cap: Mesh.CAP_ALL },
    scene,
  );
  cyl.position = from.add(to).scale(0.5);
  const q = new Quaternion();
  Quaternion.FromUnitVectorsToRef(UP, axis.scale(1 / height), q);
  cyl.rotationQuaternion = q;
  register(cyl);
}
