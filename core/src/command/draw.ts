import type { Mesh } from "@babylonjs/core";
import { registerCommand, type ICommand } from "./base";
import { Frame } from "../system/frame";
import type { Atom, Bond } from "../system/item";
import {
  draw_atom,
  draw_frame,
  draw_bond,
  draw_box,
  type IDrawAtomOptions,
  type IDrawFrameOptions,
  type IDrawBondOptions,
} from "../artist";
import type { Molvis } from "../app";
import type { IEntity } from "../system";
import type { IProp } from "../system/base";

// Inline type for Python Frame data
type FrameData = {
  blocks?: {
    atoms?: {
      xyz?: number[][];
      type?: string[];
      element?: string[];
      name?: string[];
      [key: string]: unknown[] | undefined;
    };
    bonds?: {
      i?: number[];
      j?: number[];
      order?: number[];
    };
  };
  box?: {
    matrix: number[][];
    pbc?: boolean[];
    origin: number[];
  };
};

@registerCommand("draw_atom")
class DrawAtom implements ICommand {
  private app: Molvis;

  constructor(app: Molvis) {
    this.app = app;
  }

  public do(args: {
    name: string;
    x: number;
    y: number;
    z: number;
    options: IDrawAtomOptions;
  }) {
    const { name, x, y, z, options, ...props } = args;
    const atom = this.app.system.current_frame.add_atom(name, x, y, z, props);
    const sphere = draw_atom(this.app, atom, options ?? {});
    return [[sphere], [atom]] as [Mesh[], IEntity[]];
  }

  public undo() {}
}

@registerCommand("draw_bond")
class DrawBond implements ICommand {
  private app: Molvis;

  constructor(app: Molvis) {
    this.app = app;
  }

  public do(args: {
    x1: number;
    y1: number;
    z1: number;
    x2: number;
    y2: number;
    z2: number;
    props?: Record<string, IProp>;
    options: IDrawBondOptions;
  }) {
    const { x1, y1, z1, x2, y2, z2, props, options } = args;
    const itom = this.app.system.current_frame.add_atom(
      "bond",
      x1,
      y1,
      z1,
      props,
    );
    const jtom = this.app.system.current_frame.add_atom(
      "bond",
      x2,
      y2,
      z2,
      props,
    );
    const bond = this.app.system.current_frame.add_bond(itom, jtom, props);
    const tubes = draw_bond(this.app, bond, options);
    return [tubes, [bond]] as [Mesh[], IEntity[]];
  }

  public undo() {}
}

@registerCommand("draw_frame")
class DrawFrame implements ICommand {
  private app: Molvis;

  constructor(app: Molvis) {
    this.app = app;
  }

  public do(args: {
    frameData: FrameData;
    options: IDrawFrameOptions;
  }) {
    const { frameData, options } = args;
    console.log(frameData);
    const atoms: Atom[] = [];
    const bonds: Bond[] = [];

    // Create a new frame instead of modifying current_frame
    const frame = new Frame();
    const frame_atoms = frameData.blocks?.atoms || {};
    const frame_bonds = frameData.blocks?.bonds || {};

    // Register atoms in ECS
    if (frame_atoms.xyz) {
      const {
        xyz,
        type = [],
        element = [],
        name = [],
        ...rest
      } = frame_atoms;
      for (let i = 0; i < xyz.length; i++) {
        const atomType = type[i] || element[i] || "C";
        const atomName = name[i] || `atom_${i}`;
        const props: Record<string, IProp> = {
          type: atomType,
          element: element[i] || atomType,
        };
        // Add any extra properties
        for (const key in rest) {
          if (rest[key] && rest[key][i] !== undefined) {
            props[key] = rest[key][i] as IProp;
          }
        }
        const atom = frame.add_atom(atomName, xyz[i][0], xyz[i][1], xyz[i][2], props);
        atoms.push(atom);
      }
    }
    console.log(frame_bonds.i, frame_bonds.j, atoms.length);
    // Register bonds in ECS
    if (frame_bonds?.i && frame_bonds?.j && atoms.length > 0) {
      const { i, j, order = [] } = frame_bonds;
      for (let idx = 0; idx < i.length; idx++) {
        console.log(i[idx], j[idx]);
        console.log(atoms[i[idx]], atoms[j[idx]]);
        if (atoms[i[idx]] && atoms[j[idx]]) {
          const bond = frame.add_bond(atoms[i[idx]], atoms[j[idx]], {
            order: order[idx] || 1,
          });
          bonds.push(bond);
        }
      }
    }

    // Register frame in ECS
    this.app.system.append_frame(frame);
    this.app.gui.updateFrameIndicator(
      this.app.system.current_frame_index,
      this.app.system.n_frames,
    );

    // Draw using standard draw_frame and draw_box
    const meshes = draw_frame(this.app, frame, options);
    if (frameData.box && options.box?.visible !== false) {
      // Ensure pbc is always an array
      const boxData = {
        ...frameData.box,
        pbc: frameData.box.pbc ?? [true, true, true],
      };
      meshes.push(...draw_box(this.app, boxData, options.box || {}));
    }
    return [meshes, [...frame.atoms, ...frame.bonds]] as [Mesh[], IEntity[]];
  }

  public undo() {}
}

export { DrawAtom, DrawBond, DrawFrame };
