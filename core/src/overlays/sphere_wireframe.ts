import type { Scene } from "@babylonjs/core";
import { RegionWireframeOverlay } from "./region_wireframe";
import type { SphereWireframeProps } from "./types";

/**
 * A wireframe sphere drawn as a latitude/longitude line net — the visual idiom
 * of a confining cavity or bounding shell.
 *
 * This is the sphere specialization of {@link RegionWireframeOverlay}; reach for
 * that class directly for the other molpack region shapes (box, ellipsoid,
 * cylinder, plane, gaussian). Its `type` is `"sphere_wireframe"`.
 */
export class SphereWireframeOverlay extends RegionWireframeOverlay {
  constructor(id: string, props: SphereWireframeProps, scene: Scene) {
    super(
      id,
      {
        kind: "sphere",
        radius: props.radius,
        center: props.center,
        latitudes: props.latitudes,
        longitudes: props.longitudes,
        segments: props.segments,
        color: props.color,
        opacity: props.opacity,
      },
      scene,
    );
  }
}
