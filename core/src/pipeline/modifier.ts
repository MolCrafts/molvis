import type { Frame } from "@molcrafts/molrs";
import type {
  PipelineContext,
  SelectionMask as SelectionMaskType,
  ValidationResult,
} from "./types";
import { SelectionMask } from "./types";

/**
 * Capability tags describing what a modifier does. A modifier may
 * declare any subset — capabilities are independent and can co-occur
 * (e.g. BackboneRibbon both transforms data and draws).
 */
export enum ModifierCapability {
  /** Reads context.currentSelection. Drives default selection scoping. */
  ConsumesSelection = "consumes-selection",
  /** Writes to context.selectionCache / context.currentSelection. */
  ProducesSelection = "produces-selection",
  /** Returns a Frame distinct from input (filters atoms, adds blocks, etc). */
  TransformsData = "transforms-data",
  /** Performs render side-effects via ctx.app.artist. */
  Draws = "draws",
}

/** Stable display ordering of capability labels (used for UI badges). */
const CAPABILITY_DISPLAY_ORDER: ReadonlyArray<ModifierCapability> = [
  ModifierCapability.Draws,
  ModifierCapability.ProducesSelection,
  ModifierCapability.ConsumesSelection,
  ModifierCapability.TransformsData,
];

/**
 * Pick a single label for compact UI / RPC display. Returns the
 * first capability in the canonical display order; never throws.
 */
export function primaryCapabilityLabel(
  caps: ReadonlySet<ModifierCapability>,
): ModifierCapability | null {
  for (const cap of CAPABILITY_DISPLAY_ORDER) {
    if (caps.has(cap)) return cap;
  }
  return null;
}

/**
 * Base interface for all modifiers in the pipeline.
 */
export interface Modifier {
  /** Unique identifier for this modifier instance. */
  readonly id: string;

  /** Human-readable name for UI display. */
  readonly name: string;

  /** Whether this modifier is currently enabled. */
  enabled: boolean;

  /** Capability tags. See {@link ModifierCapability}. */
  readonly capabilities: ReadonlySet<ModifierCapability>;

  /**
   * ID of the parent selection-producing modifier, or null for root-level.
   * When set, this modifier consumes the selection produced by the parent.
   */
  parentId: string | null;

  /**
   * Auto-attach predicate. When a frame is loaded and a probe of this
   * class returns `true`, the modifier is automatically inserted into
   * the pipeline.
   *
   * - Auto-attaching modifiers (Draw*, BackboneRibbon) override to return
   *   true based on frame contents (e.g., `frame.simbox` defined).
   * - User-opt-in modifiers (Slice, WrapPBC, ExpressionSelect, ...)
   *   inherit the BaseModifier default of `false`.
   *
   * MUST NOT mutate the frame. Throws are caught upstream and treated
   * as no-match.
   */
  matches(frame: Frame): boolean;

  /**
   * Applicability predicate. Returns `true` when this modifier can run
   * on `frame` without producing garbage or crashing — distinct from
   * {@link matches}, which decides whether to auto-attach.
   *
   * Default is `true` (most modifiers are universally applicable). Only
   * data-gated modifiers (e.g. BackboneRibbon, which requires protein
   * backbone columns) override this.
   *
   * Used by the manual-add picker to disable inapplicable entries, and
   * by `apply()` as a defensive guard against being run on a frame
   * whose topology has changed since the modifier was added.
   */
  isApplicable(frame: Frame): boolean;

  /** Validate that this modifier can be applied to the input frame. */
  validate(input: Frame, context: PipelineContext): ValidationResult;

  /**
   * Apply this modifier to the input frame, producing a new frame.
   * Modifiers should not mutate the input frame.
   *
   * Draw modifiers return the input frame unchanged and instead perform
   * render side-effects via `context.app.artist`. They inspect
   * `context.changeKind` to decide between full rebuild and
   * position-only update.
   *
   * May return a `Promise<Frame>` when the modifier needs to await
   * async work whose completion gates downstream pipeline steps —
   * notably `DrawAtomModifier` / `DrawBondModifier`, which await shader
   * compilation before registering atom/bond buffers in
   * `SceneIndex`. Returning the bare `Frame` synchronously is still
   * legal (and remains the common case for pure data transforms).
   * `ModifierPipeline.compute` `await`s every apply() so both forms
   * work transparently.
   */
  apply(input: Frame, context: PipelineContext): Frame | Promise<Frame>;

  /**
   * Get a cache key for this modifier's current state.
   * Used for caching modifier results.
   */
  getCacheKey(): string;

  /**
   * Sync this modifier's render layer to `visible`. Default no-op on
   * `BaseModifier`; `Draws`-capability modifiers override (mesh
   * `setEnabled`, ribbon `setVisible`, …). `MolvisApp.applyPipeline`
   * calls this with `m.enabled` after every compute() so toggling a
   * modifier's checkbox in the UI hides its mesh.
   */
  applyVisibility(app: import("../app").MolvisApp, visible: boolean): void;
}

/**
 * Abstract base class for modifiers with common functionality.
 */
export abstract class BaseModifier implements Modifier {
  public enabled = true;
  public parentId: string | null = null;

  constructor(
    public readonly id: string,
    public readonly name: string,
    public readonly capabilities: ReadonlySet<ModifierCapability>,
  ) {}

  /** Default: not auto-attached. Subclasses override to opt in. */
  matches(_frame: Frame): boolean {
    return false;
  }

  /** Default: applicable to every frame. Data-gated modifiers override. */
  isApplicable(_frame: Frame): boolean {
    return true;
  }

  /**
   * Default validation: always valid.
   * Override in subclasses for specific validation logic.
   */
  validate(_input: Frame, _context: PipelineContext): ValidationResult {
    return { valid: true };
  }

  /**
   * Bring the modifier's render layer in line with `visible`. Default:
   * no-op (most modifiers don't own a renderable layer). `Draws`-
   * capability modifiers override to call e.g. `mesh.setEnabled(visible)`
   * or `ribbonRenderer.setVisible(visible)`. Invoked from
   * `MolvisApp.applyPipeline` after every `compute()` so disabling a
   * modifier in the UI hides its mesh on the next pipeline tick — and
   * re-enabling it restores visibility without forcing a full rebuild.
   */
  applyVisibility(_app: import("../app").MolvisApp, _visible: boolean): void {
    // no-op
  }

  /**
   * Apply this modifier. Must be implemented by subclasses. May return
   * `Promise<Frame>` when the modifier awaits async work that must
   * complete before subsequent pipeline steps run (e.g. shader compile
   * inside Draw modifiers). See {@link Modifier.apply} for details.
   */
  abstract apply(
    input: Frame,
    context: PipelineContext,
  ): Frame | Promise<Frame>;

  /**
   * Default cache key: modifier id + enabled state.
   * Override in subclasses to include modifier-specific parameters.
   */
  getCacheKey(): string {
    return `${this.id}:${this.enabled}`;
  }

  /**
   * Helper: Get the effective selection for this modifier.
   * Modifiers that consume selection use currentSelection by default.
   * Modifiers that don't consume selection use "all" by default.
   */
  protected getEffectiveSelection(
    context: PipelineContext,
    frameSize: number,
  ): SelectionMaskType {
    if (this.capabilities.has(ModifierCapability.ConsumesSelection)) {
      return context.currentSelection;
    }
    return SelectionMask.all(frameSize);
  }
}
