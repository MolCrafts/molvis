/**
 * OVITO-style **Color by Type**: categorical color by `element` column
 * (falls back to `type` when element is absent — set by the user in the
 * Color by Property panel if needed).
 *
 * Thin preset over {@link ColorByPropertyModifier}; same coloring pipeline.
 */

import { ColorByPropertyModifier } from "./ColorByPropertyModifier";

export class ColorByTypeModifier extends ColorByPropertyModifier {
  static readonly NAME = "Color by Type";

  constructor(id = "color-by-type-default") {
    super(id);
    this._name = ColorByTypeModifier.NAME;
    this.columnName = "element";
    this.categorical = true;
  }
}
