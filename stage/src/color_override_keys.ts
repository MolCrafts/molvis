/**
 * Color-override column keys — the one place `stage/` spells the strings that
 * name a per-atom color injected into an atoms Block.
 *
 * A frame's atoms Block normally carries no color at all: the artist resolves
 * one per atom from `element` (or `type`) through the style system. A color
 * modifier that wants to override that decision — color by a property ramp, by
 * cluster id, by structure-order class, by an explicit assignment — writes
 * three synthetic float columns onto the atoms Block instead, one per linear
 * RGB channel, and the artist's buffer builders read them back and use them in
 * place of the style color. The `__` prefix marks them as renderer-internal:
 * they are not chemistry data, they never come from a file reader, and nothing
 * outside this handshake should be reading or writing them.
 *
 * Writers: `./modifiers/ColorByPropertyModifier.ts`,
 * `./modifiers/AssignColorModifier.ts`, `./modifiers/ClusterModifier.ts`,
 * `./modifiers/structure_order_shared.ts`.
 * Readers: `./artist/atom_buffer.ts`, `./artist/representation_draw.ts`.
 *
 * **Zero imports, deliberately.** These keys are the only thing the pipeline's
 * color modifiers and the artist's buffer builders need to agree on, and this
 * module sits below both layers so that agreement costs neither one an edge to
 * the other. An artist buffer builder importing a pipeline modifier — which
 * value-imports molrs, hence WASM (WebAssembly) — to read three column names
 * was exactly the coupling this module exists to cut. Keep it import-free: no molrs, no style
 * manager, no modifier, no helper.
 */

/** Linear-RGB red channel of the per-atom color override. */
export const COLOR_OVERRIDE_R = "__color_r";

/** Linear-RGB green channel of the per-atom color override. */
export const COLOR_OVERRIDE_G = "__color_g";

/** Linear-RGB blue channel of the per-atom color override. */
export const COLOR_OVERRIDE_B = "__color_b";
