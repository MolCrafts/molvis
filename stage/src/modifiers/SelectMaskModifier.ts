import { toRowIndex } from "@molcrafts/molvis-core";
import type { Block, Frame } from "@molcrafts/molvis-core/molrs";
import { BaseModifier, ModifierCapability } from "../pipeline/modifier";
import type { PipelineContext, ValidationResult } from "../pipeline/types";
import { SelectionMask } from "../pipeline/types";
import type { ProjectParams } from "../project/params";
import {
  type MaskFileParseResult,
  parseMaskFile,
} from "../selection/mask_file";
import { DType } from "../utils/dtype";

/** FNV-1a over the 4 bytes of each sorted atom id → stable 32-bit hex. */
function hashIds(ids: readonly number[]): string {
  let hash = 0x811c9dc5;
  for (const value of ids) {
    for (let shift = 0; shift < 32; shift += 8) {
      hash ^= (value >>> shift) & 0xff;
      hash = Math.imul(hash, 0x01000193);
    }
  }
  return (hash >>> 0).toString(16);
}

/**
 * Selection producer backed by a MolVis mask file: a set of atom ids (the
 * molrs canonical `id` column, u32 — see `selection/mask_file.ts`). Replace
 * semantics, like {@link ExpressionSelectionModifier} /
 * `SelectTypeModifier`.
 *
 * Ids are resolved against the frame at this modifier's pipeline position
 * (post any upstream delete/replicate). Place it right after the data
 * source(s) unless it is intentionally scoping a later subset.
 */
export class SelectMaskModifier extends BaseModifier {
  static readonly NAME = "Select from mask";

  private _ids: number[] = [];
  private _expectedCount: number | null = null;
  private _sourceLabel: string | null = null;

  constructor(id = "select-mask-default") {
    super(
      id,
      SelectMaskModifier.NAME,
      new Set([ModifierCapability.ProducesSelection]),
    );
  }

  /** Selected atom ids (molrs `id` column), sorted ascending and deduplicated. */
  get ids(): readonly number[] {
    return this._ids;
  }

  /** Value of the optional `@atoms` directive, or null. */
  get expectedCount(): number | null {
    return this._expectedCount;
  }

  /** Source filename (or other label) for UI display, or null. */
  get sourceLabel(): string | null {
    return this._sourceLabel;
  }

  /**
   * Parse mask text and replace this selector's mask. Throws
   * {@link MaskFileSyntaxError} on malformed content; callers surface it as
   * a user-facing error rather than a crash.
   */
  setMaskText(
    text: string,
    opts?: { sourceName?: string },
  ): MaskFileParseResult {
    const parsed = parseMaskFile(text);
    this._ids = parsed.ids;
    this._expectedCount = parsed.expectedCount;
    this._sourceLabel = opts?.sourceName ?? null;
    return parsed;
  }

  /** @see {@link ../project/params ProjectParamsCarrier} */
  toProjectParams(): ProjectParams {
    return {
      ids: [...this._ids],
      expectedCount: this._expectedCount,
      sourceLabel: this._sourceLabel,
    };
  }

  /** Hydration-only setter used by project load. */
  fromProjectParams(params: {
    ids?: unknown;
    expectedCount?: unknown;
    sourceLabel?: unknown;
  }): void {
    if (Array.isArray(params.ids)) {
      const valid = params.ids.filter(
        (value): value is number =>
          typeof value === "number" &&
          Number.isSafeInteger(value) &&
          value >= 0,
      );
      this._ids = [...new Set(valid)].sort((a, b) => a - b);
    }
    this._expectedCount =
      typeof params.expectedCount === "number" &&
      Number.isSafeInteger(params.expectedCount)
        ? params.expectedCount
        : null;
    this._sourceLabel =
      typeof params.sourceLabel === "string" ? params.sourceLabel : null;
  }

  validate(input: Frame, _context: PipelineContext): ValidationResult {
    const atoms = input.has("atoms") ? input.get("atoms") : undefined;
    const atomCount = atoms?.nRows ?? 0;
    const warnings: string[] = [];
    if (this._expectedCount !== null && this._expectedCount !== atomCount) {
      warnings.push(
        `mask declares @atoms ${this._expectedCount} but the frame has ${atomCount} atoms`,
      );
    }

    const errors: string[] = [];
    const idMap = atomIdToRowMap(atoms);
    if (this._ids.length > 0 && idMap === null) {
      errors.push(
        "mask selects by atom id but the frame has no `id` column to resolve against",
      );
    } else if (idMap !== null) {
      const unknown = this._ids.filter((id) => !idMap.has(id));
      if (unknown.length > 0) {
        const shown = unknown.slice(0, 10);
        const more =
          unknown.length > shown.length
            ? ` (+${unknown.length - shown.length} more)`
            : "";
        errors.push(
          `mask atom ids not present in frame: ${shown.join(", ")}${more}`,
        );
      }
    }

    if (errors.length > 0) return { valid: false, errors, warnings };
    return { valid: true, warnings };
  }

  apply(input: Frame, context: PipelineContext): Frame {
    const atoms = input.has("atoms") ? input.get("atoms") : undefined;
    const atomCount = atoms?.nRows ?? 0;
    const idMap = atomIdToRowMap(atoms);
    // validate() is the loud gate; when the frame carries no `id` column the
    // mask cannot be resolved, so select nothing rather than mis-index rows.
    const rows =
      idMap !== null
        ? this._ids
            .map((id) => idMap.get(id))
            .filter((row): row is number => row !== undefined)
        : [];
    const mask = SelectionMask.fromIndices(atomCount, rows);
    context.selectionSet.set(this.id, mask);
    context.currentSelection = mask;
    return input;
  }

  getCacheKey(): string {
    return `${super.getCacheKey()}:${hashIds(this._ids)}:${this._expectedCount ?? ""}`;
  }
}

/**
 * Map each atom `id` to its row index in the atoms block. Returns null when
 * there is no atoms block or no `id` column to resolve against.
 */
function atomIdToRowMap(atoms: Block | undefined): Map<number, number> | null {
  if (atoms === undefined || atoms.nRows === 0) return null;
  // molrs pins the canonical "id" column to domain uint / u64
  // (Block::insert refuses any other dtype under that key).
  if (!atoms.has("id") || atoms.dtype("id") !== DType.Uint) return null;
  const ids = atoms.copy("id") as BigUint64Array;
  if (!ids) return null;
  const map = new Map<number, number>();
  for (let r = 0; r < ids.length; r++) map.set(toRowIndex(ids[r]), r);
  return map;
}
