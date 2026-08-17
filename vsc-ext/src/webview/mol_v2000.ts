/**
 * Minimal MOL V2000 connection-table parser for Sketch Quick View peek.
 * Host-safe: no sketch/stage imports (unit-testable under tsconfig.test).
 */

export type MolAtom2D = {
  element: string;
  x: number;
  y: number;
};

export type MolBond2D = {
  i: number;
  j: number;
  order: number;
};

export type MolMoleculeData = {
  atoms: MolAtom2D[];
  bonds: MolBond2D[];
};

/**
 * Parse a V2000 MOL/SDF block into 2D atom/bond data.
 * Returns null when the payload is not a recognizable MOL block.
 */
export function tryParseMolV2000(text: string): MolMoleculeData | null {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  let countsIdx = -1;
  for (let i = 0; i < Math.min(lines.length, 10); i++) {
    if (lines[i].includes("V2000") && /\d+\s+\d+/.test(lines[i])) {
      countsIdx = i;
      break;
    }
    const m = lines[i].match(/^\s*(\d+)\s+(\d+)\b/);
    if (m && i >= 3) {
      countsIdx = i;
      break;
    }
  }
  if (countsIdx < 0) return null;
  const counts = lines[countsIdx].match(/^\s*(\d+)\s+(\d+)/);
  if (!counts) return null;
  const nAtoms = Number(counts[1]);
  const nBonds = Number(counts[2]);
  if (!Number.isFinite(nAtoms) || nAtoms <= 0 || nAtoms > 10_000) return null;
  if (!Number.isFinite(nBonds) || nBonds < 0 || nBonds > 50_000) return null;

  const atoms: MolAtom2D[] = [];
  for (let i = 0; i < nAtoms; i++) {
    const line = lines[countsIdx + 1 + i];
    if (!line) return null;
    const parts = line.trim().split(/\s+/);
    if (parts.length < 4) return null;
    const x = Number(parts[0]);
    const y = Number(parts[1]);
    const element = parts[3];
    if (!Number.isFinite(x) || !Number.isFinite(y) || !element) return null;
    atoms.push({ element, x, y });
  }

  const bonds: MolBond2D[] = [];
  for (let i = 0; i < nBonds; i++) {
    const line = lines[countsIdx + 1 + nAtoms + i];
    if (!line) return null;
    const parts = line.trim().split(/\s+/);
    if (parts.length < 3) return null;
    const a = Number(parts[0]) - 1;
    const b = Number(parts[1]) - 1;
    const order = Number(parts[2]) || 1;
    if (
      !Number.isInteger(a) ||
      !Number.isInteger(b) ||
      a < 0 ||
      b < 0 ||
      a >= nAtoms ||
      b >= nAtoms
    ) {
      return null;
    }
    bonds.push({ i: a, j: b, order: order >= 1 && order <= 3 ? order : 1 });
  }

  return { atoms, bonds };
}
