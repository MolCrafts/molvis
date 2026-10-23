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
  return block.has(columns.x) && block.has(columns.y) && block.has(columns.z);
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

  const x = block.view(columns.x) as Float64Array;
  const y = block.view(columns.y) as Float64Array;
  const z = block.view(columns.z) as Float64Array;
  if (!x || !y || !z) return undefined;

  return { columns, x, y, z };
}
