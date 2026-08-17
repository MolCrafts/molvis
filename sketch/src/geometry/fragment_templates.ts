import type { Atom2D, Bond2D, MoleculeData } from "../types";
import { buildRingTemplate } from "./ring_template";
import { DEFAULT_BOND_LENGTH } from "./snap";

/**
 * How a fragment root attaches when the user clicks an existing atom.
 * - `merge` — root atom coincides with the target (e.g. phenyl carbon).
 * - `bond` — root is a new atom bonded to the target (e.g. –OH oxygen).
 */
export type FragmentAttachMode = "merge" | "bond";

export type FragmentCategoryId = "groups" | "rings" | "fused";

export interface FragmentTemplate {
  id: string;
  category: FragmentCategoryId;
  /** Accessible name only — UI previews are structure diagrams, not text. */
  label: string;
  data: MoleculeData;
  /** Atom index placed at the click / merge target. */
  rootIndex: number;
  attachMode: FragmentAttachMode;
}

export interface FragmentCategory {
  id: FragmentCategoryId;
  /** Accessible category name (submenu label uses structure glyph + aria). */
  label: string;
  templates: FragmentTemplate[];
}

const BL = DEFAULT_BOND_LENGTH;
const COS60 = 0.5;
const SIN60 = Math.sqrt(3) / 2;

function mol(atoms: Atom2D[], bonds: Bond2D[]): MoleculeData {
  return { atoms, bonds };
}

function ringScaffold(
  size: number,
  kind: "aliphatic" | "benzene",
  hetero?: { index: number; element: string },
): MoleculeData {
  const ring = buildRingTemplate(size, 0, 0, BL, kind);
  const atoms: Atom2D[] = ring.vertices.map((v, index) => ({
    element: hetero && hetero.index === index ? hetero.element : "C",
    x: v.x,
    y: v.y,
  }));
  const bonds: Bond2D[] = ring.edges.map(([i, j], edgeIdx) => ({
    i,
    j,
    order: kind === "benzene" ? (edgeIdx % 2 === 0 ? 2 : 1) : 1,
  }));
  return mol(atoms, bonds);
}

/**
 * 5-membered heteroaromatic Kekulé (furan / thiophene / pyrrole family).
 * Hetero at index 0 (top); doubles on C=C edges 1–2 and 3–4.
 */
function aromaticFiveHetero(element: string): MoleculeData {
  const data = ringScaffold(5, "aliphatic", { index: 0, element });
  const bonds = data.bonds.map((b, idx) => {
    // edges: 0-1, 1-2, 2-3, 3-4, 4-0 → doubles at 1 and 3
    if (idx === 1 || idx === 3) return { ...b, order: 2 };
    return { ...b };
  });
  return mol(
    data.atoms.map((a) => ({ ...a })),
    bonds,
  );
}

function phenylFragment(): MoleculeData {
  const data = ringScaffold(6, "benzene");
  // Root at bottom vertex for typical ChemDraw-like attachment
  let root = 0;
  for (let i = 1; i < data.atoms.length; i++) {
    if (data.atoms[i].y < data.atoms[root].y) root = i;
  }
  if (root === 0) return data;
  const atoms = data.atoms.map((a) => ({ ...a }));
  const tmp = atoms[0];
  atoms[0] = atoms[root];
  atoms[root] = tmp;
  const bonds = data.bonds.map((b) => {
    const map = (idx: number) => (idx === 0 ? root : idx === root ? 0 : idx);
    return { ...b, i: map(b.i), j: map(b.j) };
  });
  return mol(atoms, bonds);
}

/**
 * Fused naphthalene (two fused hexagons, Kekulé). Root = outer left carbon.
 *
 * Pointy-top regular hexagon: circumradius R = bond length. The right edge is
 * vertical at x = R·cos(30°) = R·√3/2 relative to the ring center, so two
 * edge-fused hexagons have center–center distance R·√3 (not R — that leaves a
 * gap and the shared-vertex merge never fires → two disconnected benzenes).
 */
function naphthalene(): MoleculeData {
  const r = BL; // benzene circumradius = bond length
  // Half of center–center distance for edge fusion.
  const half = (r * Math.sqrt(3)) / 2;
  const leftCx = -half;
  const rightCx = half;

  const verts: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < 6; i++) {
    const ang = -Math.PI / 2 + (i * Math.PI) / 3;
    verts.push({ x: leftCx + r * Math.cos(ang), y: r * Math.sin(ang) });
  }
  const rightVerts: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < 6; i++) {
    const ang = -Math.PI / 2 + (i * Math.PI) / 3;
    rightVerts.push({
      x: rightCx + r * Math.cos(ang),
      y: r * Math.sin(ang),
    });
  }
  // Map right ring onto left: shared fusion-edge vertices coincide, four outer
  // carbons are new. Threshold is tight once geometry is correct.
  const atoms: Atom2D[] = verts.map((v) => ({ element: "C", x: v.x, y: v.y }));
  const indexMap = new Array<number>(6);
  const mergeTol = 0.15 * BL;
  for (let i = 0; i < 6; i++) {
    const rv = rightVerts[i];
    let best = -1;
    let bestD = mergeTol;
    for (let j = 0; j < atoms.length; j++) {
      const d = Math.hypot(atoms[j].x - rv.x, atoms[j].y - rv.y);
      if (d < bestD) {
        bestD = d;
        best = j;
      }
    }
    if (best >= 0) {
      indexMap[i] = best;
    } else {
      indexMap[i] = atoms.length;
      atoms.push({ element: "C", x: rv.x, y: rv.y });
    }
  }

  const bonds: Bond2D[] = [];
  const addBond = (i: number, j: number, order: number) => {
    if (i === j) return;
    const a = Math.min(i, j);
    const b = Math.max(i, j);
    if (bonds.some((bond) => bond.i === a && bond.j === b)) return;
    bonds.push({ i: a, j: b, order });
  };
  // Left ring Kekulé
  for (let i = 0; i < 6; i++) {
    addBond(i, (i + 1) % 6, i % 2 === 0 ? 2 : 1);
  }
  // Right ring Kekulé (orders staggered so fusion edge is single on both sides)
  for (let i = 0; i < 6; i++) {
    const a = indexMap[i];
    const b = indexMap[(i + 1) % 6];
    addBond(a, b, i % 2 === 0 ? 1 : 2);
  }

  // Root = leftmost atom (min x)
  let root = 0;
  for (let i = 1; i < atoms.length; i++) {
    if (atoms[i].x < atoms[root].x) root = i;
  }
  if (root !== 0) {
    // Swap root to index 0 for stable attach index
    const tmp = atoms[0];
    atoms[0] = atoms[root];
    atoms[root] = tmp;
    for (const bond of bonds) {
      if (bond.i === 0) bond.i = root;
      else if (bond.i === root) bond.i = 0;
      if (bond.j === 0) bond.j = root;
      else if (bond.j === root) bond.j = 0;
    }
  }
  return mol(atoms, bonds);
}

function functionalGroups(): FragmentTemplate[] {
  return [
    {
      id: "oh",
      category: "groups",
      label: "Hydroxyl",
      rootIndex: 0,
      attachMode: "bond",
      data: mol(
        [
          { element: "O", x: 0, y: 0 },
          { element: "H", x: BL * COS60, y: BL * SIN60 },
        ],
        [{ i: 0, j: 1, order: 1 }],
      ),
    },
    {
      id: "nh2",
      category: "groups",
      label: "Amino",
      rootIndex: 0,
      attachMode: "bond",
      data: mol(
        [
          { element: "N", x: 0, y: 0 },
          { element: "H", x: BL * COS60, y: BL * SIN60 },
          { element: "H", x: BL * COS60, y: -BL * SIN60 },
        ],
        [
          { i: 0, j: 1, order: 1 },
          { i: 0, j: 2, order: 1 },
        ],
      ),
    },
    {
      id: "ch3",
      category: "groups",
      label: "Methyl",
      rootIndex: 0,
      attachMode: "bond",
      data: mol([{ element: "C", x: 0, y: 0 }], []),
    },
    {
      id: "och3",
      category: "groups",
      label: "Methoxy",
      rootIndex: 0,
      attachMode: "bond",
      data: mol(
        [
          { element: "O", x: 0, y: 0 },
          { element: "C", x: BL, y: 0 },
        ],
        [{ i: 0, j: 1, order: 1 }],
      ),
    },
    {
      id: "cho",
      category: "groups",
      label: "Formyl",
      rootIndex: 0,
      attachMode: "bond",
      data: mol(
        [
          { element: "C", x: 0, y: 0 },
          { element: "O", x: BL, y: 0 },
          { element: "H", x: -BL * COS60, y: BL * SIN60 },
        ],
        [
          { i: 0, j: 1, order: 2 },
          { i: 0, j: 2, order: 1 },
        ],
      ),
    },
    {
      id: "cooh",
      category: "groups",
      label: "Carboxyl",
      rootIndex: 0,
      attachMode: "bond",
      data: mol(
        [
          { element: "C", x: 0, y: 0 },
          { element: "O", x: BL, y: 0 },
          { element: "O", x: -BL * COS60, y: -BL * SIN60 },
          { element: "H", x: -BL * COS60 - BL, y: -BL * SIN60 },
        ],
        [
          { i: 0, j: 1, order: 2 },
          { i: 0, j: 2, order: 1 },
          { i: 2, j: 3, order: 1 },
        ],
      ),
    },
    {
      id: "cn",
      category: "groups",
      label: "Cyano",
      rootIndex: 0,
      attachMode: "bond",
      data: mol(
        [
          { element: "C", x: 0, y: 0 },
          { element: "N", x: BL, y: 0 },
        ],
        [{ i: 0, j: 1, order: 3 }],
      ),
    },
    {
      id: "no2",
      category: "groups",
      label: "Nitro",
      rootIndex: 0,
      attachMode: "bond",
      data: mol(
        [
          { element: "N", x: 0, y: 0 },
          { element: "O", x: BL * COS60, y: BL * SIN60 },
          { element: "O", x: BL * COS60, y: -BL * SIN60 },
        ],
        [
          { i: 0, j: 1, order: 2 },
          { i: 0, j: 2, order: 1 },
        ],
      ),
    },
    {
      id: "cf3",
      category: "groups",
      label: "Trifluoromethyl",
      rootIndex: 0,
      attachMode: "bond",
      data: mol(
        [
          { element: "C", x: 0, y: 0 },
          { element: "F", x: BL, y: 0 },
          { element: "F", x: -BL * COS60, y: BL * SIN60 },
          { element: "F", x: -BL * COS60, y: -BL * SIN60 },
        ],
        [
          { i: 0, j: 1, order: 1 },
          { i: 0, j: 2, order: 1 },
          { i: 0, j: 3, order: 1 },
        ],
      ),
    },
    {
      id: "sh",
      category: "groups",
      label: "Thiol",
      rootIndex: 0,
      attachMode: "bond",
      data: mol(
        [
          { element: "S", x: 0, y: 0 },
          { element: "H", x: BL * COS60, y: BL * SIN60 },
        ],
        [{ i: 0, j: 1, order: 1 }],
      ),
    },
  ];
}

function ringFragments(): FragmentTemplate[] {
  return [
    {
      id: "benzene",
      category: "rings",
      label: "Benzene",
      rootIndex: 0,
      attachMode: "merge",
      data: ringScaffold(6, "benzene"),
    },
    {
      // Aryl substituent (Ph–): same scaffold as benzene, root at bottom for attach.
      id: "phenyl",
      category: "rings",
      label: "Phenyl",
      rootIndex: 0,
      attachMode: "merge",
      data: phenylFragment(),
    },
    {
      id: "pyridine",
      category: "rings",
      label: "Pyridine",
      rootIndex: 0,
      attachMode: "merge",
      data: ringScaffold(6, "benzene", { index: 0, element: "N" }),
    },
    {
      id: "pyrimidine",
      category: "rings",
      label: "Pyrimidine",
      rootIndex: 0,
      attachMode: "merge",
      data: (() => {
        const data = ringScaffold(6, "benzene", { index: 0, element: "N" });
        const atoms = data.atoms.map((a, i) =>
          i === 2 ? { ...a, element: "N" } : { ...a },
        );
        return mol(
          atoms,
          data.bonds.map((b) => ({ ...b })),
        );
      })(),
    },
    {
      id: "furan",
      category: "rings",
      label: "Furan",
      rootIndex: 0,
      attachMode: "merge",
      data: aromaticFiveHetero("O"),
    },
    {
      id: "thiophene",
      category: "rings",
      label: "Thiophene",
      rootIndex: 0,
      attachMode: "merge",
      data: aromaticFiveHetero("S"),
    },
    {
      id: "pyrrole",
      category: "rings",
      label: "Pyrrole",
      rootIndex: 0,
      attachMode: "merge",
      data: aromaticFiveHetero("N"),
    },
    {
      id: "imidazole",
      category: "rings",
      label: "Imidazole",
      rootIndex: 0,
      attachMode: "merge",
      data: (() => {
        const data = ringScaffold(5, "aliphatic", { index: 0, element: "N" });
        const atoms = data.atoms.map((a, i) =>
          i === 2 ? { ...a, element: "N" } : { ...a },
        );
        // Standard imidazole Kekulé: doubles on 0–1 and 2–3
        const bonds = data.bonds.map((b, idx) => {
          if (idx === 0 || idx === 2) return { ...b, order: 2 };
          return { ...b };
        });
        return mol(atoms, bonds);
      })(),
    },
    {
      id: "cyclohexane",
      category: "rings",
      label: "Cyclohexane",
      rootIndex: 0,
      attachMode: "merge",
      data: ringScaffold(6, "aliphatic"),
    },
    {
      id: "cyclopentane",
      category: "rings",
      label: "Cyclopentane",
      rootIndex: 0,
      attachMode: "merge",
      data: ringScaffold(5, "aliphatic"),
    },
  ];
}

function fusedFragments(): FragmentTemplate[] {
  return [
    {
      id: "naphthalene",
      category: "fused",
      label: "Naphthalene",
      rootIndex: 0,
      attachMode: "merge",
      data: naphthalene(),
    },
  ];
}

const CATEGORIES: FragmentCategory[] = [
  // Chem-editor catalog labels (short, structure-first menus).
  { id: "groups", label: "Groups", templates: functionalGroups() },
  { id: "rings", label: "Rings", templates: ringFragments() },
  { id: "fused", label: "Fused rings", templates: fusedFragments() },
];

const BY_ID = new Map<string, FragmentTemplate>();
for (const category of CATEGORIES) {
  for (const template of category.templates) {
    BY_ID.set(template.id, template);
  }
}

/** Ordered fragment categories for host template menus. */
export function listFragmentCategories(): readonly FragmentCategory[] {
  return CATEGORIES;
}

/** All templates in catalog order. */
export function listFragmentTemplates(): readonly FragmentTemplate[] {
  return CATEGORIES.flatMap((c) => c.templates);
}

/** Lookup by stable id, or null. */
export function getFragmentTemplate(id: string): FragmentTemplate | null {
  return BY_ID.get(id) ?? null;
}

/** Default fragment when entering the fragment tool. */
export const DEFAULT_FRAGMENT_ID = "phenyl";
