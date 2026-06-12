import { anglesFromForward, ISO_ALPHA, ISO_BETA, type ViewAngles } from "./fit";
import type { Obb } from "./obb";

/**
 * Choose an auto camera direction that maximizes the projected silhouette:
 * look down the OBB's minor axis (smallest spread), so flat or elongated
 * structures face the camera broadside.
 *
 * For a {@link Obb.degenerate} cloud (collinear/coplanar/isotropic, or fewer
 * than three points) the minor axis is ill-defined, so fall back to the stable
 * isometric angles ({@link ISO_ALPHA}/{@link ISO_BETA}) rather than a noisy,
 * FP-fragile direction.
 */
export function pickViewDirection(obb: Obb): ViewAngles {
  if (obb.degenerate) {
    return { alpha: ISO_ALPHA, beta: ISO_BETA };
  }
  const minor = obb.axes[2];
  return anglesFromForward([-minor[0], -minor[1], -minor[2]]);
}
