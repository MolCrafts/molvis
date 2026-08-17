import type { Frame } from "@molcrafts/molvis-core/molrs";
import { DType } from "../utils/dtype";

/** Serializable outline for hosts (VS Code tree, future web outline). */
export type StructureOutlineNode = {
  id: string;
  label: string;
  kind: "chain" | "residue" | "atom" | "source";
  atomIndices?: number[];
  children?: StructureOutlineNode[];
};

export type StructureOutline = {
  roots: StructureOutlineNode[];
};

/**
 * Build a chain → residue → atom tree from an atoms block.
 * Missing chain/residue columns fall back to a flat atom list (capped).
 */
export function buildStructureOutline(
  frame: Frame,
  options?: { maxAtomsListed?: number },
): StructureOutline {
  const maxAtoms = options?.maxAtomsListed ?? 2000;
  const atoms = frame.getBlock("atoms");
  if (!atoms || atoms.nrows() === 0) {
    return { roots: [] };
  }

  const n = atoms.nrows();
  const hasChain = atoms.dtype("chain_id") === DType.String;
  const resSeq = atoms.viewColF("res_seq");
  const hasResName = atoms.dtype("res_name") === DType.String;
  const hasName = atoms.dtype("name") === DType.String;
  const hasElement = atoms.dtype("element") === DType.String;

  const chainIds = hasChain ? (atoms.copyColStr("chain_id") as string[]) : null;
  const resNames = hasResName
    ? (atoms.copyColStr("res_name") as string[])
    : null;
  const names = hasName ? (atoms.copyColStr("name") as string[]) : null;
  const elements = hasElement
    ? (atoms.copyColStr("element") as string[])
    : null;

  // No hierarchy columns → flat atom list (capped).
  if (!chainIds && !resSeq) {
    const children: StructureOutlineNode[] = [];
    const limit = Math.min(n, maxAtoms);
    for (let i = 0; i < limit; i++) {
      const el = elements?.[i]?.trim() || "?";
      const nm = names?.[i]?.trim();
      children.push({
        id: `atom:${i}`,
        label: nm ? `${nm} (${el}) #${i}` : `${el} #${i}`,
        kind: "atom",
        atomIndices: [i],
      });
    }
    return {
      roots: [
        {
          id: "source:0",
          label:
            n > maxAtoms ? `Atoms (${n}, showing ${maxAtoms})` : `Atoms (${n})`,
          kind: "source",
          atomIndices: Array.from({ length: n }, (_, i) => i),
          children,
        },
      ],
    };
  }

  // chain → residue → atom
  type ResBucket = {
    label: string;
    atoms: { index: number; label: string }[];
  };
  const chains = new Map<string, Map<string, ResBucket>>();

  for (let i = 0; i < n; i++) {
    const chain = (chainIds?.[i] ?? " ").trim() || "A";
    const seq = resSeq ? Math.round(resSeq[i]) : 0;
    const rname = (resNames?.[i] ?? "UNK").trim() || "UNK";
    const resKey = `${chain}|${seq}|${rname}`;
    let resMap = chains.get(chain);
    if (!resMap) {
      resMap = new Map();
      chains.set(chain, resMap);
    }
    let bucket = resMap.get(resKey);
    if (!bucket) {
      bucket = { label: `${rname} ${seq}`, atoms: [] };
      resMap.set(resKey, bucket);
    }
    const el = elements?.[i]?.trim() || "?";
    const nm = names?.[i]?.trim();
    bucket.atoms.push({
      index: i,
      label: nm ? `${nm} (${el})` : `${el} #${i}`,
    });
  }

  const roots: StructureOutlineNode[] = [];
  for (const [chain, resMap] of chains) {
    const residues: StructureOutlineNode[] = [];
    const chainAtomIndices: number[] = [];
    for (const [resKey, bucket] of resMap) {
      const atomNodes: StructureOutlineNode[] = bucket.atoms.map((a) => ({
        id: `atom:${a.index}`,
        label: a.label,
        kind: "atom" as const,
        atomIndices: [a.index],
      }));
      const indices = bucket.atoms.map((a) => a.index);
      chainAtomIndices.push(...indices);
      residues.push({
        id: `res:${resKey}`,
        label: bucket.label,
        kind: "residue",
        atomIndices: indices,
        children: atomNodes.length <= 40 ? atomNodes : undefined,
      });
    }
    roots.push({
      id: `chain:${chain}`,
      label: `Chain ${chain}`,
      kind: "chain",
      atomIndices: chainAtomIndices,
      children: residues,
    });
  }

  return { roots };
}
