import { type Box, type Frame, WasmArray } from "@molcrafts/molrs";
import { writeResidueRows } from "../artist/ribbon/backbone_block";
import type { Residue } from "../artist/ribbon/pdb_backbone";
import {
  DEFAULT_RIBBON_STYLE,
  type RibbonColorMode,
  type RibbonStyle,
} from "../artist/ribbon/ribbon_style";
import { assignSecondaryStructure } from "../artist/ribbon/secondary_structure";
import { BaseModifier, ModifierCapability } from "./modifier";
import type { PipelineContext } from "./types";

const BACKBONE_NAMES = new Set(["N", "CA", "C", "O"]);

/**
 * Squared tolerance for "raw displacement equals minimum-image
 * displacement" — allowing for floating-point round-trip noise in the
 * WASM matrix multiply that produces minimum-image vectors. A genuine
 * PBC jump moves the displacement by at least one full cell vector
 * (tens of Å on every realistic system), so this threshold is many
 * orders of magnitude away from any false-positive.
 */
const MI_AGREEMENT_TOL_SQ = 1e-6;

/**
 * Squared CA–CA distance (Å²) above which we treat consecutive
 * residues of the same chain as a chain break — a genuine peptide
 * bond constrains CA[i+1] − CA[i] to ≈ 3.8 Å. 4.5 Å is the
 * conservative cutoff used by PyMOL/ChimeraX for cartoon segment
 * splitting; anything looser would still draw a "ghost bridge"
 * across missing-residue regions, which is the origin of the
 * twisted-leaf artefacts at disordered loops.
 */
const CA_CA_BREAK_DIST_SQ = 4.5 * 4.5;

/**
 * After sorting `rows` by `(chainId, resSeq)`, scan consecutive Cα
 * pairs and rename `chain_id` whenever a pair spans either:
 *   1. A periodic boundary — detected threshold-free by comparing
 *      `r[i] − r[i−1]` to `Box.delta(..., true)`. The two agree iff
 *      the pair lies inside a single image; any disagreement means
 *      the pair crosses at least one full cell vector.
 *   2. A real chain break — raw CA–CA distance > {@link CA_CA_BREAK_DIST_SQ}.
 *      Catches missing residues (`resSeq` jumps from 50 → 60 with the
 *      structure rebuilt across a gap), disordered termini, and
 *      multi-residue loop deletions. Without this, `RibbonRenderer`
 *      would happily fit a smooth spline across a 20 Å gap and
 *      produce the warped triangle strips users see as "twisted leaves".
 *
 * Each split increments a `__brk{n}` suffix on subsequent residues
 * so `readBackboneBlock` groups them as a separate chain and the
 * RibbonRenderer draws independent splines.
 */
function splitChainsAtBreaks(rows: Residue[], box: Box | undefined): void {
  if (rows.length < 2) return;

  const pairCount = rows.length - 1;
  const aBuf = new Float64Array(pairCount * 3);
  const bBuf = new Float64Array(pairCount * 3);
  for (let i = 1; i < rows.length; i++) {
    const k = (i - 1) * 3;
    // biome-ignore lint/style/noNonNullAssertion: rows pre-filtered to have ca
    const pca = rows[i - 1].ca!;
    // biome-ignore lint/style/noNonNullAssertion: same
    const cca = rows[i].ca!;
    aBuf[k] = pca.x;
    aBuf[k + 1] = pca.y;
    aBuf[k + 2] = pca.z;
    bBuf[k] = cca.x;
    bBuf[k + 1] = cca.y;
    bBuf[k + 2] = cca.z;
  }

  // Minimum-image displacements only when a box is present. The
  // gap-distance check below works in either regime — without a box,
  // the raw distance *is* the physical distance.
  let miBuf: Float64Array | null = null;
  if (box) {
    const a = WasmArray.from(aBuf, new Uint32Array([pairCount, 3]));
    const b = WasmArray.from(bBuf, new Uint32Array([pairCount, 3]));
    try {
      const mi = box.delta(a, b, true);
      try {
        miBuf = mi.toCopy() as Float64Array;
      } finally {
        mi.free();
      }
    } finally {
      a.free();
      b.free();
    }
  }

  let prevOrigChain: string | null = null;
  let breaksInChain = 0;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const origChain = r.chainId;
    if (i === 0 || origChain !== prevOrigChain) {
      breaksInChain = 0;
    } else {
      const k = (i - 1) * 3;
      const rawDx = bBuf[k] - aBuf[k];
      const rawDy = bBuf[k + 1] - aBuf[k + 1];
      const rawDz = bBuf[k + 2] - aBuf[k + 2];
      const rawDistSq = rawDx * rawDx + rawDy * rawDy + rawDz * rawDz;

      let isBreak = false;

      // Real chain break by CA–CA distance.
      if (rawDistSq > CA_CA_BREAK_DIST_SQ) {
        isBreak = true;
      }

      // PBC wrap: raw vs minimum-image displacements diverge.
      if (!isBreak && miBuf) {
        const ddx = rawDx - miBuf[k];
        const ddy = rawDy - miBuf[k + 1];
        const ddz = rawDz - miBuf[k + 2];
        if (ddx * ddx + ddy * ddy + ddz * ddz > MI_AGREEMENT_TOL_SQ) {
          isBreak = true;
        }
      }

      if (isBreak) breaksInChain++;
    }
    if (breaksInChain > 0) {
      r.chainId = `${origChain}__brk${breaksInChain}`;
    }
    prevOrigChain = origChain;
  }
}

/**
 * Single modifier covering both backbone derivation and ribbon
 * rendering for protein frames.
 *
 * Auto-attaches when the atoms block carries the four PDB-parity
 * residue columns (`name`, `res_name`, `res_seq`, `chain_id`) AND
 * at least one CA atom — the same predicate that distinguishes a
 * polymer from a small-molecule frame.
 *
 * On `apply` the modifier:
 * 1. Walks the atoms block, groups N/CA/C/O atoms by
 *    `(chain_id, res_seq)` into a residues table.
 * 2. Runs a geometric DSSP-lite pass to assign helix/sheet/coil.
 * 3. Writes a `residues` block onto the frame.
 * 4. Tells the artist to (re)build the ribbon mesh from it.
 *
 * This was originally split across `BackboneRibbonModifier`
 * (TransformsData) and a separate render call — but the two were
 * always attached together and never independently useful, so they
 * collapsed back into one modifier with capabilities
 * `{TransformsData, Draws}`.
 */
export class DrawRibbonModifier extends BaseModifier {
  static readonly NAME = "Draw Ribbon";

  private _colorMode: RibbonColorMode = DEFAULT_RIBBON_STYLE.colorMode;
  private _uniformColor: [number, number, number] = [
    ...DEFAULT_RIBBON_STYLE.uniformColor,
  ];
  private _widthScale: number = DEFAULT_RIBBON_STYLE.widthScale;
  private _smoothness: number = DEFAULT_RIBBON_STYLE.smoothness;
  private _opacity: number = DEFAULT_RIBBON_STYLE.opacity;

  constructor(id = "draw-ribbon") {
    super(
      id,
      DrawRibbonModifier.NAME,
      new Set([ModifierCapability.TransformsData, ModifierCapability.Draws]),
    );
  }

  get colorMode(): RibbonColorMode {
    return this._colorMode;
  }
  set colorMode(value: RibbonColorMode) {
    this._colorMode = value;
  }
  get uniformColor(): readonly [number, number, number] {
    return this._uniformColor;
  }
  setUniformColor(rgb: readonly [number, number, number]): void {
    this._uniformColor = [rgb[0], rgb[1], rgb[2]];
  }
  get widthScale(): number {
    return this._widthScale;
  }
  set widthScale(value: number) {
    this._widthScale = Math.max(0.1, Math.min(5, value));
  }
  get smoothness(): number {
    return this._smoothness;
  }
  set smoothness(value: number) {
    this._smoothness = Math.max(2, Math.min(24, Math.round(value)));
  }
  get opacity(): number {
    return this._opacity;
  }
  set opacity(value: number) {
    this._opacity = Math.max(0, Math.min(1, value));
  }

  getCacheKey(): string {
    return [
      super.getCacheKey(),
      `cm=${this._colorMode}`,
      `uc=${this._uniformColor.join(",")}`,
      `w=${this._widthScale}`,
      `s=${this._smoothness}`,
      `o=${this._opacity}`,
    ].join(":");
  }

  private currentStyle(): RibbonStyle {
    return {
      colorMode: this._colorMode,
      uniformColor: this._uniformColor,
      widthScale: this._widthScale,
      smoothness: this._smoothness,
      opacity: this._opacity,
    };
  }

  matches(frame: Frame): boolean {
    return DrawRibbonModifier.isProteinFrame(frame);
  }

  static isProteinFrame(frame: Frame): boolean {
    const atoms = frame.getBlock("atoms");
    if (!atoms) return false;
    const hasResColumns =
      atoms.dtype("name") === "string" &&
      atoms.dtype("res_name") === "string" &&
      atoms.dtype("res_seq") === "i32" &&
      atoms.dtype("chain_id") === "string";
    if (!hasResColumns) return false;
    const names = atoms.copyColStr("name") as string[];
    for (let i = 0; i < names.length; i++) {
      if (names[i].trim() === "CA") return true;
    }
    return false;
  }

  apply(input: Frame, ctx: PipelineContext): Frame {
    if (!DrawRibbonModifier.isProteinFrame(input)) return input;
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

    const rows: Residue[] = [];
    for (const r of byChainRes.values()) if (r.ca) rows.push(r);
    rows.sort(
      (a, b) => a.chainId.localeCompare(b.chainId) || a.resSeq - b.resSeq,
    );

    splitChainsAtBreaks(rows, input.simbox);
    assignSecondaryStructure(rows);
    writeResidueRows(input, rows);

    ctx.app.artist.drawRibbon(input, this.currentStyle());
    return input;
  }

  applyVisibility(app: import("../app").MolvisApp, visible: boolean): void {
    app.artist.ribbonRenderer.setVisible(visible);
  }
}
