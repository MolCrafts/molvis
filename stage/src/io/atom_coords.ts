import type { Block } from "@molcrafts/molvis-core/molrs";

const XYZ_COLUMNS = { x: "x", y: "y", z: "z" } as const;
const XU_COLUMNS = { x: "xu", y: "yu", z: "zu" } as const;

export interface AtomCoordColumns {
  x: "x" | "xu";
  y: "y" | "yu";
  z: "z" | "zu";
}

export interface AtomCoords {
  columns: AtomCoordColumns;
  x: Float64Array;
  y: Float64Array;
  z: Float64Array;
}

function hasCoordTriplet(block: Block, columns: AtomCoordColumns): boolean {
  return (
    block.dtype(columns.x) !== undefined &&
    block.dtype(columns.y) !== undefined &&
    block.dtype(columns.z) !== undefined
  );
}

export function resolveAtomCoordColumns(
  block: Block,
): AtomCoordColumns | undefined {
  if (hasCoordTriplet(block, XYZ_COLUMNS)) return XYZ_COLUMNS;
  if (hasCoordTriplet(block, XU_COLUMNS)) return XU_COLUMNS;
  return undefined;
}

export function viewAtomCoords(block: Block): AtomCoords | undefined {
  const columns = resolveAtomCoordColumns(block);
  if (!columns) return undefined;

  const x = block.viewColF(columns.x);
  const y = block.viewColF(columns.y);
  const z = block.viewColF(columns.z);
  if (!x || !y || !z) return undefined;

  return { columns, x, y, z };
}
