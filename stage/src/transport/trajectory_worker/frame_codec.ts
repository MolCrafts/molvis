/**
 * Reconstruct a real molrs `Frame` from a `FrameMessage` payload received
 * from the trajectory worker.
 *
 * This is the worker-boundary counterpart to `transport/rpc/wire.ts`, which
 * does the same job for the RPC envelope. The two differ in what they are
 * handed: a `FrameMessage` arrives structured-cloned, so its columns are
 * already typed arrays and there is no buffer-ref indirection, no carrier
 * checking, and no encode direction to mirror. Schema judgment belongs to
 * neither — `Validator::canonical` runs molrs-side.
 *
 * The returned `Frame` owns its WASM memory. Disposal is the caller's
 * responsibility (the `Trajectory` LRU cache calls `frame.free()` on
 * eviction; tests typically rely on GC).
 */

import { Box, Frame } from "@molcrafts/molvis-core/molrs";
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
        default: {
          // `ColumnPayload` is a closed union, so this is unreachable today and
          // the `never` binding makes adding a variant a compile error. It
          // still throws rather than falling through: dropping the column
          // would hand back a Frame that is silently missing data, and the
          // caller (`runtime.onFrame`) already turns a throw into a rejected
          // frame request.
          const unknown: never = col;
          throw new Error(
            `rehydrateFrame: unknown column dtype ${JSON.stringify(
              (unknown as { dtype?: unknown }).dtype,
            )} for column ${JSON.stringify(
              (unknown as { name?: unknown }).name,
            )} in block ${JSON.stringify(block.name)}`,
          );
        }
      }
    }
  }

  if (msg.box) {
    frame.box = new Box(
      msg.box.h,
      msg.box.origin,
      msg.box.pbc[0],
      msg.box.pbc[1],
      msg.box.pbc[2],
    );
  }

  // Volumetric grids land as a single `"grid"` block on the frame.
  // Each `GridPayload` contributes one or more value columns whose
  // length is `Nx*Ny*Nz`; the block's `shape` carries the 3D
  // dimensions. Origin/cell/pbc on the GridPayload are dropped — the
  // cloud renderer reads geometry from `frame.box`. CHGCAR / POSCAR
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
