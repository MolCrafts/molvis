/**
 * Reconstruct a real molrs `Frame` from a `FrameMessage` payload received
 * from the trajectory worker.
 *
 * This is the *only* place in the codebase that builds a `Frame` from
 * pre-parsed typed arrays. Everywhere else, `Frame` instances flow from
 * either an in-process molrs reader or this codec — never both at once
 * for the same trajectory.
 *
 * The returned `Frame` owns its WASM memory. Disposal is the caller's
 * responsibility (the `Trajectory` LRU cache calls `frame.free()` on
 * eviction; tests typically rely on GC).
 */

import { Box, Frame } from "@molcrafts/molrs";
import type { FrameMessage, GridPayload } from "./protocol";

/** Build a real molrs `Frame` from a worker payload. */
export function rehydrateFrame(msg: FrameMessage): Frame {
  const frame = new Frame();

  for (const block of msg.blocks) {
    const handle = frame.createBlock(block.name);
    for (const col of block.columns) {
      switch (col.dtype) {
        case "f64":
          handle.setColF(col.name, col.data);
          break;
        case "u32":
          handle.setColU32(col.name, col.data);
          break;
        case "i32":
          handle.setColI32(col.name, col.data);
          break;
        case "string":
          handle.setColStr(col.name, col.data);
          break;
      }
    }
  }

  if (msg.simbox) {
    frame.simbox = new Box(
      msg.simbox.h,
      msg.simbox.origin,
      msg.simbox.pbc[0],
      msg.simbox.pbc[1],
      msg.simbox.pbc[2],
    );
  }

  // Volumetric grids land as a single `"grid"` block on the frame.
  // Each `GridPayload` contributes one or more value columns whose
  // length is `Nx*Ny*Nz`; the block's `shape` carries the 3D
  // dimensions. Origin/cell/pbc on the GridPayload are dropped — the
  // cloud renderer reads geometry from `frame.simbox`. CHGCAR / POSCAR
  // / CUBE all share grid lattice with the simulation box, so this is
  // lossless in practice. If a future format needs an independent
  // voxel basis we'll surface it via Block meta later.
  if (msg.grids.length > 0) {
    populateGridBlock(frame, msg.grids);
  }

  return frame;
}

function populateGridBlock(frame: Frame, grids: GridPayload[]): void {
  const reference = grids[0];
  if (reference.shape.length !== 3) return;

  const block = frame.createBlock("grid");
  let columnsAdded = 0;

  for (const grid of grids) {
    if (!shapesMatch(grid.shape, reference.shape)) continue;
    for (const arr of grid.arrays) {
      const column = grids.length > 1 ? `${grid.name}.${arr.name}` : arr.name;
      block.setColF(column, arr.data);
      columnsAdded += 1;
    }
  }

  if (columnsAdded === 0) return;
  block.setShape(reference.shape);
}

function shapesMatch(a: Uint32Array, b: Uint32Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
