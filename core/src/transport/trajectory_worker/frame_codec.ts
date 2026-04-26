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

import { Box, Frame, Grid } from "@molcrafts/molrs";
import type { FrameMessage } from "./protocol";

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

  for (const grid of msg.grids) {
    const g = new Grid(
      grid.shape[0],
      grid.shape[1],
      grid.shape[2],
      grid.origin,
      grid.cell,
      grid.pbc[0],
      grid.pbc[1],
      grid.pbc[2],
    );
    for (const arr of grid.arrays) g.insertArray(arr.name, arr.data);
    frame.insertGrid(grid.name, g);
  }

  return frame;
}
