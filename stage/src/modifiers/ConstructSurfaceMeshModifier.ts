/**
 * OVITO-style **Construct surface mesh**.
 *
 * Gaussian-density → marching-cubes path (same backend as
 * {@link GaussianDensitySurfaceModifier}) with denser default grid.
 */

import { GaussianDensitySurfaceModifier } from "../pipeline/gaussian_density_surface";

export class ConstructSurfaceMeshModifier extends GaussianDensitySurfaceModifier {
  /** Display / registry name (distinct from GaussianDensitySurfaceModifier.NAME). */
  static readonly DISPLAY_NAME = "Construct surface mesh";

  constructor(id = "construct-surface-mesh-default") {
    super(id);
    this.setGrid(48, 48, 48);
    this.setSigma(1.2);
    this._name = ConstructSurfaceMeshModifier.DISPLAY_NAME;
  }
}
