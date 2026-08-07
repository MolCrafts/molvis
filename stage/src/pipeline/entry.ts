/**
 * The common base of everything that occupies a row in the pipeline list.
 *
 * The pipeline holds two kinds of thing, and they are not variants of one
 * another:
 *
 * - {@link DataSource} **contributes** a `Trajectory`. It is consumed by the
 *   composition head (`system/source_composition.ts`) before any transform
 *   runs, so its position in the list carries no execution meaning.
 * - {@link Modifier} **transforms** a `Frame`. It runs in list order, and that
 *   order is its whole semantics.
 *
 * Before this split a source was a `Modifier` whose `apply()` returned its
 * input unchanged, and `ModifierPipeline.compute` had to skip those identity
 * calls explicitly. The runtime already treated the two as separate — two
 * phases, two lifecycles (`app.addDataSource` vs `pipeline.addModifier`), two
 * RPC method families (`scene.add_data_source` vs `pipeline.add_modifier`) —
 * and only the type hierarchy still claimed they were one kind. This interface
 * is the part they genuinely share: an identity, a label, and a switch.
 *
 * A third implementor is coming (the backend session, which neither
 * contributes nor transforms) — hence a base that promises nothing about data.
 */
export interface PipelineEntry {
  /** Unique identifier for this entry. Assigned by the pipeline on insert. */
  readonly id: string;

  /** Human-readable name for UI display. */
  readonly name: string;

  /** Whether this entry is currently active. */
  enabled: boolean;

  /**
   * Optional teardown when the entry leaves the pipeline. Side-effect
   * modifiers (e.g. Camera track) stop observers here.
   *
   * Note that `DataSource` deliberately does **not** free its WASM resources
   * from here — see {@link DataSource.dispose} for why release is explicit.
   */
  onRemoved?(): void;
}
