/** Gallery cameras sit 30° closer to +Z than the ordinary isometric view. */
export const GALLERY_CAMERA_Z_OFFSET = Math.PI / 6;

/** Advance one gallery turntable camera by a render-frame delta. */
export function advanceGalleryCameraRotation(
  camera: { alpha: number },
  deltaMilliseconds: number,
  rotationSpeed: number,
): void {
  if (rotationSpeed <= 0) return;
  camera.alpha += (deltaMilliseconds / 1000) * rotationSpeed;
}
