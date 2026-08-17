/**
 * Extract backbone trace and secondary structure assignments from raw PDB text.
 * This is a lightweight TypeScript parser — molrs's PDB reader doesn't expose
 * atom_name, res_name, chain_id, res_seq, or HELIX/SHEET records yet.
 */

export interface BackboneAtom {
  x: number;
  y: number;
  z: number;
  atomName: string; // "CA", "C", "N", "O"
  resName: string;
  chainId: string;
  resSeq: number;
}

export type SecondaryStructureType = "helix" | "sheet" | "coil";

export interface SecondaryStructureRange {
  type: SecondaryStructureType;
  chainId: string;
  startResSeq: number;
  endResSeq: number;
}

export interface Residue {
  resName: string;
  resSeq: number;
  chainId: string;
  ca: BackboneAtom | undefined;
  c: BackboneAtom | undefined;
  n: BackboneAtom | undefined;
  o: BackboneAtom | undefined;
  ss: SecondaryStructureType;
}

export interface ChainTrace {
  chainId: string;
  residues: Residue[];
}

/**
 * Parse raw PDB text to extract backbone traces with secondary structure.
 * Returns one ChainTrace per chain, with residues sorted by resSeq.
 */
export function parsePdbBackbone(pdbText: string): ChainTrace[] {
  const lines = pdbText.split("\n");

  // 1. Parse HELIX/SHEET records
  const ssRanges: SecondaryStructureRange[] = [];
  for (const line of lines) {
    if (line.startsWith("HELIX ")) {
      const chainId = line[19]?.trim() || "A";
      const startSeq = Number.parseInt(line.substring(21, 25).trim(), 10);
      const endSeq = Number.parseInt(line.substring(33, 37).trim(), 10);
      if (!Number.isNaN(startSeq) && !Number.isNaN(endSeq)) {
        ssRanges.push({
          type: "helix",
          chainId,
          startResSeq: startSeq,
          endResSeq: endSeq,
        });
      }
    } else if (line.startsWith("SHEET ")) {
      const chainId = line[21]?.trim() || "A";
      const startSeq = Number.parseInt(line.substring(22, 26).trim(), 10);
      const endSeq = Number.parseInt(line.substring(33, 37).trim(), 10);
      if (!Number.isNaN(startSeq) && !Number.isNaN(endSeq)) {
        ssRanges.push({
          type: "sheet",
          chainId,
          startResSeq: startSeq,
          endResSeq: endSeq,
        });
      }
    }
  }

  // 2. Parse ATOM records for backbone atoms (N, CA, C, O)
  const BACKBONE_NAMES = new Set(["N", "CA", "C", "O"]);
  const backboneAtoms: BackboneAtom[] = [];

  for (const line of lines) {
    if (!line.startsWith("ATOM  ")) continue;
    const atomName = line.substring(12, 16).trim();
    if (!BACKBONE_NAMES.has(atomName)) continue;

    const resName = line.substring(17, 20).trim();
    const chainId = line[21]?.trim() || "A";
    const resSeq = Number.parseInt(line.substring(22, 26).trim(), 10);
    const x = Number.parseFloat(line.substring(30, 38));
    const y = Number.parseFloat(line.substring(38, 46));
    const z = Number.parseFloat(line.substring(46, 54));

    if (
      Number.isNaN(x) ||
      Number.isNaN(y) ||
      Number.isNaN(z) ||
      Number.isNaN(resSeq)
    )
      continue;

    backboneAtoms.push({ x, y, z, atomName, resName, chainId, resSeq });
  }

  // 3. Group by chain → residue
  const chainMap = new Map<string, Map<number, Residue>>();

  for (const atom of backboneAtoms) {
    let residueMap = chainMap.get(atom.chainId);
    if (!residueMap) {
      residueMap = new Map();
      chainMap.set(atom.chainId, residueMap);
    }

    let residue = residueMap.get(atom.resSeq);
    if (!residue) {
      residue = {
        resName: atom.resName,
        resSeq: atom.resSeq,
        chainId: atom.chainId,
        ca: undefined,
        c: undefined,
        n: undefined,
        o: undefined,
        ss: "coil",
      };
      residueMap.set(atom.resSeq, residue);
    }

    switch (atom.atomName) {
      case "CA":
        residue.ca = atom;
        break;
      case "C":
        residue.c = atom;
        break;
      case "N":
        residue.n = atom;
        break;
      case "O":
        residue.o = atom;
        break;
    }
  }

  // 4. Assign secondary structure
  for (const range of ssRanges) {
    const residueMap = chainMap.get(range.chainId);
    if (!residueMap) continue;
    for (const [seq, residue] of residueMap) {
      if (seq >= range.startResSeq && seq <= range.endResSeq) {
        residue.ss = range.type;
      }
    }
  }

  // 5. Build sorted chain traces (only chains with CA atoms)
  const chains: ChainTrace[] = [];
  for (const [chainId, residueMap] of chainMap) {
    const residues = Array.from(residueMap.values())
      .filter((r) => r.ca !== undefined)
      .sort((a, b) => a.resSeq - b.resSeq);
    if (residues.length >= 2) {
      chains.push({ chainId, residues });
    }
  }

  return chains;
}

/**
 * Determine the secondary structure of a residue given ranges and chain/resSeq.
 */
export function getSecondaryStructure(
  ranges: SecondaryStructureRange[],
  chainId: string,
  resSeq: number,
): SecondaryStructureType {
  for (const r of ranges) {
    if (
      r.chainId === chainId &&
      resSeq >= r.startResSeq &&
      resSeq <= r.endResSeq
    ) {
      return r.type;
    }
  }
  return "coil";
}
