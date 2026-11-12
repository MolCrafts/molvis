/**
 * Instance buffers for the edit-mode impostor preview.
 *
 * The layout matches the sphere and bond impostor shaders
 * (`instanceData` centre/radius, bond `instanceData0/1`). Filling these
 * arrays is the whole update: the mesh is created once per gesture and every
 * pointer move only rewrites the numbers. These buffers belong to the
 * preview, never to `ImpostorState`, so an agent rebuilding the scene does
 * not wipe the ghost and the ghost does not wipe the agent's instances.
 */

export interface PreviewVec {
  x: number;
  y: number;
  z: number;
}

export interface PreviewColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

export class PreviewAtomBuffers {
  readonly matrix = new Float32Array(16);
  readonly instanceData = new Float32Array(4);
  readonly instanceColor = new Float32Array(4);
  /** visible, reveal, pick-hidden, reserved. Visible stays on. */
  readonly instanceStyle = new Float32Array([1, 0, 0, 0]);
  readonly instancePickingColor = new Float32Array(4);

  write(
    position: PreviewVec,
    radius: number,
    color: PreviewColor,
    opacity: number,
  ): void {
    const scale = radius * 2;
    const matrix = this.matrix;
    matrix[0] = scale;
    matrix[1] = 0;
    matrix[2] = 0;
    matrix[3] = 0;
    matrix[4] = 0;
    matrix[5] = scale;
    matrix[6] = 0;
    matrix[7] = 0;
    matrix[8] = 0;
    matrix[9] = 0;
    matrix[10] = scale;
    matrix[11] = 0;
    matrix[12] = position.x;
    matrix[13] = position.y;
    matrix[14] = position.z;
    matrix[15] = 1;

    this.instanceData[0] = position.x;
    this.instanceData[1] = position.y;
    this.instanceData[2] = position.z;
    this.instanceData[3] = radius;

    this.instanceColor[0] = color.r;
    this.instanceColor[1] = color.g;
    this.instanceColor[2] = color.b;
    this.instanceColor[3] = color.a * opacity;
    this.instanceStyle[0] = 1;
  }
}

export class PreviewBondBuffers {
  readonly matrix = new Float32Array(16);
  readonly instanceData0 = new Float32Array(4);
  readonly instanceData1 = new Float32Array(4);
  readonly instanceColor0 = new Float32Array(4);
  readonly instanceColor1 = new Float32Array(4);
  /** Split at the midpoint: s < 0 takes color0 (the start atom). */
  readonly instanceSplit = new Float32Array(4);
  readonly instancePickingColor = new Float32Array(4);

  /**
   * @returns false when the endpoints coincide. The caller hides the bond
   * instead of uploading a zero-length cylinder.
   */
  write(
    start: PreviewVec,
    end: PreviewVec,
    radius: number,
    startColor: PreviewColor,
    endColor: PreviewColor,
    opacity: number,
  ): boolean {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const dz = end.z - start.z;
    const length = Math.hypot(dx, dy, dz);
    if (length < 1e-8) return false;

    const inv = 1 / length;
    const dirX = dx * inv;
    const dirY = dy * inv;
    const dirZ = dz * inv;
    const cx = (start.x + end.x) * 0.5;
    const cy = (start.y + end.y) * 0.5;
    const cz = (start.z + end.z) * 0.5;
    const scale = length + radius * 2;

    const matrix = this.matrix;
    matrix[0] = scale;
    matrix[1] = 0;
    matrix[2] = 0;
    matrix[3] = 0;
    matrix[4] = 0;
    matrix[5] = scale;
    matrix[6] = 0;
    matrix[7] = 0;
    matrix[8] = 0;
    matrix[9] = 0;
    matrix[10] = scale;
    matrix[11] = 0;
    matrix[12] = cx;
    matrix[13] = cy;
    matrix[14] = cz;
    matrix[15] = 1;

    this.instanceData0[0] = cx;
    this.instanceData0[1] = cy;
    this.instanceData0[2] = cz;
    this.instanceData0[3] = radius;
    this.instanceData1[0] = dirX;
    this.instanceData1[1] = dirY;
    this.instanceData1[2] = dirZ;
    this.instanceData1[3] = length;

    this.paint(this.instanceColor0, startColor, opacity);
    this.paint(this.instanceColor1, endColor, opacity);
    return true;
  }

  private paint(
    target: Float32Array,
    color: PreviewColor,
    opacity: number,
  ): void {
    target[0] = color.r;
    target[1] = color.g;
    target[2] = color.b;
    target[3] = color.a * opacity;
  }
}
