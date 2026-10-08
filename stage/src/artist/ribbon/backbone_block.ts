/**
 * Bidirectional bridge between the PDB backbone parser and the Frame
 * `residues` block. The PDB reader populates this block at load time;
 * the RibbonRenderer reads it back at render time. Renderers therefore
 * dispatch on *data* (is there a residues block?) rather than on file
 * format, matching the same pattern used for volumetric grids.
 */

import type { Frame } from "@molcrafts/molvis-core/molrs";
import {
  type ChainTrace,
  parsePdbBackbone,
  type Residue,
  type SecondaryStructureType,
} from "./pdb_backbone";

export const RESIDUES_BLOCK = "residues";

/**
 * Write a flat residues block from already-grouped backbone rows.
 * Shared by every ingress that produces a `residues` block —
 * `writeBackboneBlock` (PDB-text driven) and the streaming-path
 * `BackboneRibbonModifier` (atoms-block driven).
 *
 * Each row's `ca` MUST be defined; rows lacking CA should be filtered
 * before calling. `o` is optional — missing oxygens become NaN. `ss`
 * uses the `SecondaryStructureType` strings ("helix" / "sheet" / "coil").
 */
export function writeResidueRows(frame: Frame, rows: Residue[]): void {
  if (rows.length === 0) return;

  const n = rows.length;
  const chainId: string[] = new Array(n);
  const resSeq = new Int32Array(n);
  const resName: string[] = new Array(n);
  const caX = new Float64Array(n);
  const caY = new Float64Array(n);
  const caZ = new Float64Array(n);
  const oX = new Float64Array(n);
  const oY = new Float64Array(n);
  const oZ = new Float64Array(n);
  const ss: string[] = new Array(n);

  for (let i = 0; i < n; i++) {
    const r = rows[i];
    chainId[i] = r.chainId;
    resSeq[i] = r.resSeq;
    resName[i] = r.resName;
    // biome-ignore lint/style/noNonNullAssertion: caller guarantees ca exists
    const ca = r.ca!;
    caX[i] = ca.x;
    caY[i] = ca.y;
    caZ[i] = ca.z;
    if (r.o) {
      oX[i] = r.o.x;
      oY[i] = r.o.y;
      oZ[i] = r.o.z;
    } else {
      oX[i] = Number.NaN;
      oY[i] = Number.NaN;
      oZ[i] = Number.NaN;
    }
    ss[i] = r.ss;
  }

  const block = frame.createBlock(RESIDUES_BLOCK);
  block.set("chain_id", chainId);
  block.set("res_seq", resSeq);
  block.set("res_name", resName);
  block.set("ca_x", caX);
  block.set("ca_y", caY);
  block.set("ca_z", caZ);
  block.set("o_x", oX);
  block.set("o_y", oY);
  block.set("o_z", oZ);
  block.set("ss", ss);
}

/**
 * Parse `pdbText` and store the resulting backbone trace as a `residues`
 * block on `frame`. No-op if the text carries no CA atoms.
 */
export function writeBackboneBlock(frame: Frame, pdbText: string): void {
  const chains = parsePdbBackbone(pdbText);
  const rows: Residue[] = [];
  for (const chain of chains) {
    for (const residue of chain.residues) {
      if (residue.ca) rows.push(residue);
    }
  }
  writeResidueRows(frame, rows);
}

/**
 * Reconstruct `ChainTrace[]` from a `residues` block. Returns an empty
 * array when the block is missing or has no CA rows. Only the fields
 * the ribbon renderer consumes (`ca`, `o`, `ss`, `chainId`, `resSeq`)
 * are reconstructed — other `Residue` fields stay undefined.
 */
export function readBackboneBlock(frame: Frame): ChainTrace[] {
  if (!frame.has(RESIDUES_BLOCK)) return [];
  const block = frame.get(RESIDUES_BLOCK);
  const n = block.nRows;
  if (n === 0) return [];

  const chainIds = block.copy("chain_id") as string[];
  const resSeqs = block.copy("res_seq") as Int32Array;
  const resNames = block.copy("res_name") as string[];
  const caX = block.copy("ca_x") as Float64Array;
  const caY = block.copy("ca_y") as Float64Array;
  const caZ = block.copy("ca_z") as Float64Array;
  const oX = block.copy("o_x") as Float64Array;
  const oY = block.copy("o_y") as Float64Array;
  const oZ = block.copy("o_z") as Float64Array;
  const ssCol = block.copy("ss") as string[];

  const byChain = new Map<string, Residue[]>();
  for (let i = 0; i < n; i++) {
    const chainId = chainIds[i];
    const resSeq = resSeqs[i];
    const resName = resNames[i];
    const residue: Residue = {
      chainId,
      resSeq,
      resName,
      ca: {
        x: caX[i],
        y: caY[i],
        z: caZ[i],
        atomName: "CA",
        resName,
        chainId,
        resSeq,
      },
      c: undefined,
      n: undefined,
      o: Number.isNaN(oX[i])
        ? undefined
        : {
            x: oX[i],
            y: oY[i],
            z: oZ[i],
            atomName: "O",
            resName,
            chainId,
            resSeq,
          },
      ss: ssCol[i] as SecondaryStructureType,
    };
    let list = byChain.get(chainId);
    if (!list) {
      list = [];
      byChain.set(chainId, list);
    }
    list.push(residue);
  }

  const chains: ChainTrace[] = [];
  for (const [chainId, residues] of byChain) {
    residues.sort((a, b) => a.resSeq - b.resSeq);
    if (residues.length >= 2) {
      chains.push({ chainId, residues });
    }
  }
  return chains;
}
