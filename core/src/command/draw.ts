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
type PythonFrameData = {
  atoms?: {
    x?: number[];
    y?: number[];
    z?: number[];
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
    const sphere = draw_atom(this.app, atom, options??{});
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
    atoms: {
      name: string[];
      x: number[];
      y: number[];
      z: number[];
      [key: string]: IProp[]; // Allow additional properties
    };
    bonds: { i: number[]; j: number[] };
    options: IDrawFrameOptions;
  }) {
    const { atoms: atomData, bonds: bondData, options } = args;
    const { name, x, y, z, ...atomProps } = atomData;
    const atomPropKeys = Object.keys(atomProps);

    // Create a new frame instead of modifying current_frame
    const frame = new Frame();
    
    const atoms = name.map((n, i) => {
      const perAtomProps = atomPropKeys.reduce(
        (acc, key) => {
          acc[key] = atomProps[key][i];
          return acc;
        },
        {} as Record<string, IProp>,
      );
      return frame.add_atom(
        n,
        x[i],
        y[i],
        z[i],
        perAtomProps,
      );
    });

    const bonds: Bond[] = [];
    if (bondData.i && bondData.j) {
      if (bondData.i.length !== bondData.j.length) {
        throw new Error("bond_i and bond_j must have the same length");
      }
      for (let i = 0; i < bondData.i.length; i++) {
        const itom = atoms[bondData.i[i]];
        const jtom = atoms[bondData.j[i]];
        const bond = frame.add_bond(itom, jtom);
        bonds.push(bond);
      }
    }

    this.app.system.append_frame(frame);
    const meshes = draw_frame(this.app, frame, options);
    this.app.gui.updateFrameIndicator(
      this.app.system.current_frame_index,
      this.app.system.n_frames,
    );
    return [meshes, [...frame.atoms, ...frame.bonds]] as [Mesh[], IEntity[]];
  }

  public undo() {}
}

@registerCommand("draw_python_frame")
class DrawPythonFrame implements ICommand {
  private app: Molvis;

  constructor(app: Molvis) {
    this.app = app;
  }

  public do(args: {
    frameData: PythonFrameData;
    options: IDrawFrameOptions;
  }) {
    const { frameData, options } = args;
    const atoms: Atom[] = [];
    const bonds: Bond[] = [];
    
    // Create a new frame instead of modifying current_frame
    const frame = new Frame();

    // Register atoms in ECS
    if (frameData.atoms?.x && frameData.atoms?.y && frameData.atoms?.z) {
      const { x, y, z, type = [], element = [], name = [], ...rest } = frameData.atoms;
      for (let i = 0; i < x.length; i++) {
        const atomType = type[i] || element[i] || 'C';
        const atomName = name[i] || `atom_${i}`;
        const props: Record<string, IProp> = { type: atomType, element: element[i] || atomType };
        // Add any extra properties
        for (const key in rest) {
          if (rest[key] && rest[key][i] !== undefined) {
            props[key] = rest[key][i] as IProp;
          }
        }
        const atom = frame.add_atom(
          atomName,
          x[i],
          y[i],
          z[i],
          props
        );
        atoms.push(atom);
      }
    }

    // Register bonds in ECS
    if (frameData.bonds?.i && frameData.bonds?.j && atoms.length > 0) {
      const { i, j, order = [] } = frameData.bonds;
      for (let idx = 0; idx < i.length; idx++) {
        if (atoms[i[idx]] && atoms[j[idx]]) {
          const bond = frame.add_bond(
            atoms[i[idx]],
            atoms[j[idx]],
            { order: order[idx] || 1 }
          );
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

export { DrawAtom, DrawBond, DrawFrame, DrawPythonFrame };
