import type { Frame } from "@molcrafts/molvis-core/molrs";

/**
 * Serializable outline for hosts (VS Code tree, future web outline).
 *
 * A node names the atoms it **owns**, and nothing else: an atom owns itself,
 * a residue owns its atoms (its children may be elided when there are many),
 * and a chain or source owns none — a host reads those from the children or
 * from {@link atomRange}. Listing a group's atoms again on the group was pure
 * duplication, and on a 500 000-atom frame it was a 3.4 MB array crossing the
 * host channel on every publish.
 */
export type StructureOutlineNode = {
  id: string;
  label: string;
  kind: "chain" | "residue" | "atom" | "source";
  /** Atoms owned directly by this node. Absent on chain / source nodes. */
  atomIndices?: number[];
  /** Atoms covered, listed or not — what a host shows as "N atoms". */
  atomCount: number;
  /**
   * Contiguous `[start, end)` cover, when the node has one. Lets a host
   * select the whole group with two numbers instead of an index per atom.
   */
  atomRange?: { start: number; end: number };
  children?: StructureOutlineNode[];
};

export type StructureOutline = {
  roots: StructureOutlineNode[];
};

/**
 * Build a chain → residue → atom tree from an atoms block.
 *
 * Residue grouping uses canonical `res_id` (uint) and `chain`. Missing hierarchy columns fall back
 * to a flat atom list (capped).
 */
export function buildStructureOutline(
  frame: Frame,
  options?: { maxAtomsListed?: number },
): StructureOutline {
  const maxAtoms = options?.maxAtomsListed ?? 2000;
  const atoms = frame.has("atoms") ? frame.get("atoms") : undefined;
  if (!atoms || atoms.nRows === 0) {
    return { roots: [] };
  }

  const n = atoms.nRows;
  const chainIds =
    atoms.has("chain") && atoms.dtype("chain") === "string"
      ? (atoms.copy("chain") as string[])
      : undefined;
  const resIds =
    atoms.has("res_id") && atoms.dtype("res_id") === "uint"
      ? (atoms.copy("res_id") as BigUint64Array)
      : undefined;
  const resNames =
    atoms.has("res_name") && atoms.dtype("res_name") === "string"
      ? (atoms.copy("res_name") as string[])
      : undefined;
  const names =
    atoms.has("name") && atoms.dtype("name") === "string"
      ? (atoms.copy("name") as string[])
      : undefined;
  const elements =
    atoms.has("element") && atoms.dtype("element") === "string"
      ? (atoms.copy("element") as string[])
      : undefined;

  if (!chainIds && !resIds) {
    const children: StructureOutlineNode[] = [];
    const limit = Math.min(n, maxAtoms);
    for (let i = 0; i < limit; i++) {
      children.push({
        id: `atom:${i}`,
        label: atomLabel(i, names, elements),
        kind: "atom",
        atomIndices: [i],
        atomCount: 1,
      });
    }
    return {
      roots: [
        {
          id: "source:0",
          label:
            n > maxAtoms ? `Atoms (${n}, showing ${maxAtoms})` : `Atoms (${n})`,
          kind: "source",
          // Row 0…n-1: a range says "every atom" in two numbers.
          atomCount: n,
          atomRange: { start: 0, end: n },
          children,
        },
      ],
    };
  }

  type ResBucket = {
    label: string;
    atoms: { index: number; label: string }[];
  };
  const chains = new Map<string, Map<string, ResBucket>>();

  for (let i = 0; i < n; i++) {
    const chain = (chainIds?.[i] ?? " ").trim() || "A";
    const seq = resIds ? resIds[i] : 0;
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
    bucket.atoms.push({
      index: i,
      label: atomLabel(i, names, elements),
    });
  }

  const roots: StructureOutlineNode[] = [];
  for (const [chain, resMap] of chains) {
    const residues: StructureOutlineNode[] = [];
    let chainAtoms = 0;
    for (const [resKey, bucket] of resMap) {
      const atomNodes: StructureOutlineNode[] = bucket.atoms.map((a) => ({
        id: `atom:${a.index}`,
        label: a.label,
        kind: "atom" as const,
        atomIndices: [a.index],
        atomCount: 1,
      }));
      const indices = bucket.atoms.map((a) => a.index);
      chainAtoms += indices.length;
      residues.push({
        id: `res:${resKey}`,
        label: bucket.label,
        kind: "residue",
        // The residue owns these: its atom children are elided above 40.
        atomIndices: indices,
        atomCount: indices.length,
        children: atomNodes.length <= 40 ? atomNodes : undefined,
      });
    }
    roots.push({
      id: `chain:${chain}`,
      label: `Chain ${chain}`,
      kind: "chain",
      atomCount: chainAtoms,
      children: residues,
    });
  }

  return { roots };
}

function atomLabel(
  i: number,
  names: string[] | undefined,
  elements: string[] | undefined,
): string {
  const el = elements?.[i]?.trim() || "?";
  const nm = names?.[i]?.trim();
  return nm ? `${nm} (${el}) #${i}` : `${el} #${i}`;
}
