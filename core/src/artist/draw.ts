import { realAtomPalette } from "./palette";
import {
  MeshBuilder,
  StandardMaterial,
  Color3,
  Vector3,
  type Mesh,
} from "@babylonjs/core";
import type { Atom, Bond } from "../system/item";
import type { Molvis } from "../app";
import type { Frame } from "../system/frame";

export interface IDrawAtomOptions {
  radius?: number;
}
export interface IDrawBondOptions {
  radius?: number;
  update?: boolean;
  order?: number;
}
export interface IDrawBoxOptions {
  visible?: boolean;
  color?: Color3;
  lineWidth?: number;
}
export interface IDrawFrameOptions {
  atoms: IDrawAtomOptions;
  bonds: IDrawBondOptions;
  box?: IDrawBoxOptions;
  clean: boolean;
}

export const draw_atom = (
  app: Molvis,
  atom: Atom,
  options: IDrawAtomOptions,
) => {
  const atype = atom.get("type") ?? atom.get("element");
  const name = (atom.get("name") as string) ?? "";
  let identifier = atype;
  if (identifier === undefined) {
    identifier = name;
  }
  const radius =
    options.radius ?? realAtomPalette.getAtomRadius(identifier as string);
  const color = realAtomPalette.getAtomColor(identifier as string);
  const sphere = MeshBuilder.CreateSphere(
    `atom:${atom.name}`,
    { diameter: radius },
    app.scene,
  );
  const material = new StandardMaterial("atom", app.scene);
  material.diffuseColor = Color3.FromHexString(color);
  sphere.material = material;
  sphere.position = atom.xyz;
  sphere.enablePointerMoveEvents = true;
  return sphere;
};

export const draw_frame = (
  app: Molvis,
  frame: Frame,
  options: IDrawFrameOptions,
) => {
  if (options !== undefined) {
    if (options.clean ?? true) {
      const meshesToDispose = [];
      for (const mesh of app.scene.meshes) {
        if (mesh.name.startsWith("atom:") || mesh.name.startsWith("bond:")) {
          meshesToDispose.push(mesh);
        }
      }
      for (const mesh of meshesToDispose) {
        mesh.dispose();
      }
    }
  }
  console.log("draw_atoms", frame.atoms);
  const spheres = frame.atoms.map((atom: Atom) =>
    draw_atom(app, atom, options.atoms),
  );
  console.log("draw_bonds", frame.bonds);
  const tubes = frame.bonds.flatMap((bond: Bond) => draw_bond(app, bond, options.bonds));
  return [...spheres, ...tubes];
};

export const draw_bond = (
  app: Molvis,
  bond: Bond,
  options: IDrawBondOptions,
) => {
  console.log("draw_bond", bond);
  const start = bond.itom.xyz;
  const end = bond.jtom.xyz;
  const order = options.order ?? bond.order;
  const radius = options.radius ?? 0.1;

  const createTube = (name: string, path: Vector3[], instance?: Mesh) => {
    if (options.update && instance) {
      return MeshBuilder.CreateTube(name, { path, radius, instance });
    }
    const tube = MeshBuilder.CreateTube(name, { path, radius, updatable: true }, app.scene);
    const material = new StandardMaterial("bond", app.scene);
    material.diffuseColor = new Color3(0.8, 0.8, 0.8);
    tube.material = material;
    return tube;
  };

  const dir = end.subtract(start);
  const axis = dir.normalize();
  let perp = Vector3.Cross(axis, Vector3.Up());
  if (perp.lengthSquared() < 1e-6) {
    perp = Vector3.Cross(axis, Vector3.Right());
  }
  perp = perp.normalize().scale(radius * 2);

  const existingTubes: Mesh[] = [];
  for (let i = 0; ; i++) {
    const m = app.scene.getMeshByName(`bond:${bond.name}:${i}`);
    if (m) existingTubes.push(m as Mesh);
    else break;
  }

  const tubes: Mesh[] = [];
  if (order === 1) {
    tubes.push(
      createTube(
        `bond:${bond.name}:0`,
        [start, end],
        existingTubes[0],
      ),
    );
  } else if (order === 2) {
    tubes.push(
      createTube(
        `bond:${bond.name}:0`,
        [start.add(perp), end.add(perp)],
        existingTubes[0],
      ),
    );
    tubes.push(
      createTube(
        `bond:${bond.name}:1`,
        [start.add(perp.scale(-1)), end.add(perp.scale(-1))],
        existingTubes[1],
      ),
    );
  } else if (order >= 3) {
    tubes.push(
      createTube(
        `bond:${bond.name}:0`,
        [start.add(perp), end.add(perp)],
        existingTubes[0],
      ),
    );
    tubes.push(
      createTube(`bond:${bond.name}:1`, [start, end], existingTubes[1]),
    );
    tubes.push(
      createTube(
        `bond:${bond.name}:2`,
        [start.add(perp.scale(-1)), end.add(perp.scale(-1))],
        existingTubes[2],
      ),
    );
  }

  for (let i = order; i < existingTubes.length; i++) {
    existingTubes[i].dispose();
  }

  return tubes;
};

export const draw_box = (
  app: Molvis,
  boxData: { matrix: number[][]; pbc: boolean[]; origin: number[] },
  options: IDrawBoxOptions = {},
) => {
  const { visible = true, color = new Color3(1, 1, 1) } = options;
  
  if (!visible) return [];

  // Clean up existing box meshes
  const meshesToDispose = [];
  for (const mesh of app.scene.meshes) {
    if (mesh.name.startsWith("box:")) {
      meshesToDispose.push(mesh);
    }
  }
  for (const mesh of meshesToDispose) {
    mesh.dispose();
  }

  const { matrix, origin } = boxData;
  
  // Convert matrix to vectors
  const a = new Vector3(matrix[0][0], matrix[0][1], matrix[0][2]);
  const b = new Vector3(matrix[1][0], matrix[1][1], matrix[1][2]);
  const c = new Vector3(matrix[2][0], matrix[2][1], matrix[2][2]);
  const o = new Vector3(origin[0], origin[1], origin[2]);

  // Calculate the 8 vertices of the box
  const vertices = [
    o,                                // 0: origin
    o.add(a),                         // 1: origin + a
    o.add(b),                         // 2: origin + b
    o.add(a).add(b),                  // 3: origin + a + b
    o.add(c),                         // 4: origin + c
    o.add(a).add(c),                  // 5: origin + a + c
    o.add(b).add(c),                  // 6: origin + b + c
    o.add(a).add(b).add(c),           // 7: origin + a + b + c
  ];

  // Define the 12 edges of the box
  const edges = [
    [0, 1], [1, 3], [3, 2], [2, 0], // bottom face
    [4, 5], [5, 7], [7, 6], [6, 4], // top face
    [0, 4], [1, 5], [2, 6], [3, 7], // vertical edges
  ];

  // Create line meshes for each edge
  const lineMeshes = [];
  for (let i = 0; i < edges.length; i++) {
    const [start, end] = edges[i];
    const points = [vertices[start], vertices[end]];
    
    const line = MeshBuilder.CreateLines(
      `box:edge:${i}`,
      { points },
      app.scene,
    );
    
    line.color = color;
    lineMeshes.push(line);
  }

  return lineMeshes;
};
