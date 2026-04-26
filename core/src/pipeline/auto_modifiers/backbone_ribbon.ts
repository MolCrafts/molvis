/**
 * `BackboneRibbonModifier` — auto-attached when a freshly-loaded frame
 * carries the columns molrs's PDB reader writes for protein structures
 * (`name`, `res_name`, `res_seq`, `chain_id` on the atoms block).
 *
 * The modifier walks the atoms block, groups backbone atoms (N/CA/C/O)
 * by `(chain_id, res_seq)`, and writes a `residues` block via the
 * shared `writeResidueRows` emitter so the schema stays in lockstep
 * with the PDB-text path (`writeBackboneBlock`).
 *
 * Compared to the old `writeBackboneBlock(frame, pdbText)` side-effect
 * inside the loader, this modifier:
 *
 * - Operates on the parsed atoms block. The original PDB text is not
 *   needed and is gone in the streaming load path.
 * - Is visible in the modifier panel; the user can disable, remove,
 *   or reparent it.
 * - Has no access to PDB `HELIX` / `SHEET` records, so secondary
 *   structure is `"coil"` for every residue. SS detection can be added
 *   later as a separate auto-modifier or via columns emitted by the
 *   PDB reader.
 */

import type { Frame } from "@molcrafts/molrs";
import { writeResidueRows } from "../../artist/ribbon/backbone_block";
import type { Residue } from "../../artist/ribbon/pdb_backbone";
import { BaseModifier, ModifierCategory } from "../modifier";
import type { PipelineContext } from "../types";

const BACKBONE_NAMES = new Set(["N", "CA", "C", "O"]);

export class BackboneRibbonModifier extends BaseModifier {
  /** Stable identifier used by the auto-attach loader to dedup and
   *  honor user-suppression. Required by `AutoAttachableModifier`. */
  static readonly autoAttachId = "backbone-ribbon";

  /** Auto-attach predicate. Returns true when `frame`'s atoms block
   *  carries the four PDB residue-identity columns this modifier needs
   *  to walk the chain. The streaming loader inspects this static on
   *  every registered modifier class to decide what to attach against
   *  a freshly loaded frame. */
  static matches(frame: Frame): boolean {
    const atoms = frame.getBlock("atoms");
    if (!atoms) return false;
    return (
      atoms.dtype("name") === "string" &&
      atoms.dtype("res_name") === "string" &&
      atoms.dtype("res_seq") === "i32" &&
      atoms.dtype("chain_id") === "string"
    );
  }

  constructor() {
    super(
      "backbone-ribbon", // pipeline assigns a NATO id on add; keep stable kind here
      "Backbone Ribbon",
      ModifierCategory.Data,
    );
  }

  apply(input: Frame, _context: PipelineContext): Frame {
    const atoms = input.getBlock("atoms");
    if (!atoms) return input;
    const n = atoms.nrows();
    if (n === 0) return input;

    const x = atoms.copyColF("x");
    const y = atoms.copyColF("y");
    const z = atoms.copyColF("z");
    const names = atoms.copyColStr("name") as string[];
    const resNames = atoms.copyColStr("res_name") as string[];
    const resSeqs = atoms.copyColI32("res_seq");
    const chainIds = atoms.copyColStr("chain_id") as string[];

    const byChainRes = new Map<string, Residue>();
    for (let i = 0; i < n; i++) {
      const atomName = names[i].trim();
      if (!BACKBONE_NAMES.has(atomName)) continue;

      const chainId = (chainIds[i] || " ").trim() || "A";
      const resSeq = resSeqs[i];
      const key = `${chainId}|${resSeq}`;

      let residue = byChainRes.get(key);
      if (!residue) {
        residue = {
          chainId,
          resSeq,
          resName: resNames[i],
          ca: undefined,
          c: undefined,
          n: undefined,
          o: undefined,
          ss: "coil",
        };
        byChainRes.set(key, residue);
      }

      const atom = {
        x: x[i],
        y: y[i],
        z: z[i],
        atomName,
        resName: residue.resName,
        chainId,
        resSeq,
      };
      if (atomName === "CA") residue.ca = atom;
      else if (atomName === "O") residue.o = atom;
      else if (atomName === "C") residue.c = atom;
      else if (atomName === "N") residue.n = atom;
    }

    // Filter to residues that actually have a CA — without one the
    // ribbon has nothing to spline through. Stable order: by chain id,
    // then by resSeq within chain.
    const rows: Residue[] = [];
    for (const r of byChainRes.values()) if (r.ca) rows.push(r);
    rows.sort(
      (a, b) => a.chainId.localeCompare(b.chainId) || a.resSeq - b.resSeq,
    );

    writeResidueRows(input, rows);
    return input;
  }
}
