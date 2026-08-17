import type { Mesh, Scene } from "@babylonjs/core";
import { MeshBuilder, Vector3 } from "@babylonjs/core";
import { WORLD_AXIS_COLORS } from "./gizmo/world_axes";

/**
 * Visual indicator showing the current camera rotation target.
 * Displays as a small 3D axes crosshair colored by the shared world-axis
 * triad (red X, green Y, blue Z) that fades after a few seconds.
 */
export class TargetIndicator {
  private mesh: Mesh | null = null;
  private scene: Scene;
  private fadeTimeout: ReturnType<typeof setTimeout> | null = null;
  private fadeInterval: ReturnType<typeof setInterval> | null = null;
  private isVisible = false;

  constructor(scene: Scene) {
    this.scene = scene;
  }

  /**
   * Show the target indicator at a specific position
   */
  show(position: Vector3, _isAtom = false): void {
    // Remove existing indicator
    this.hide();

    const size = 0.2;

    // Define axes lines
    const lines = [
      [new Vector3(-size, 0, 0), new Vector3(size, 0, 0)], // X
      [new Vector3(0, -size, 0), new Vector3(0, size, 0)], // Y
      [new Vector3(0, 0, -size), new Vector3(0, 0, size)], // Z
    ];

    // Same palette as every other axis indicator (corner triad, gizmos).
    const red = WORLD_AXIS_COLORS.x.toColor4(1);
    const green = WORLD_AXIS_COLORS.y.toColor4(1);
    const blue = WORLD_AXIS_COLORS.z.toColor4(1);

    const colors = [
      [red, red],
      [green, green],
      [blue, blue],
    ];

    // Create line system
    this.mesh = MeshBuilder.CreateLineSystem(
      "cameraTargetAxes",
      {
        lines: lines,
        colors: colors,
        useVertexAlpha: false,
      },
      this.scene,
    );

    this.mesh.position = position.clone();

    // Ensure it renders on top or clearly?
    this.mesh.renderingGroupId = 1; // Put in separate group if needed, or just standard 0
    this.mesh.isPickable = false;

    this.isVisible = true;

    // Auto-fade after 3 seconds
    this.fadeTimeout = setTimeout(() => {
      this.fadeOut();
    }, 3000);
  }

  /**
   * Fade out and hide the indicator
   */
  private fadeOut(): void {
    if (!this.mesh) return;

    // Line meshes with vertex colors don't use standard material alpha easily.
    // We can just hide it or blink it.
    // Or visibility property?
    const mesh = this.mesh;
    let alpha = 1.0;

    this.fadeInterval = setInterval(() => {
      alpha -= 0.1;
      if (alpha <= 0) {
        this.hide();
      } else {
        if (mesh.visibility !== undefined) {
          mesh.visibility = alpha;
        }
      }
    }, 50);
  }

  /**
   * Immediately hide the indicator
   */
  hide(): void {
    if (this.fadeInterval) {
      clearInterval(this.fadeInterval);
      this.fadeInterval = null;
    }

    if (this.fadeTimeout) {
      clearTimeout(this.fadeTimeout);
      this.fadeTimeout = null;
    }

    if (this.mesh) {
      this.mesh.dispose();
      this.mesh = null;
    }

    this.isVisible = false;
  }

  /**
   * Check if indicator is currently visible
   */
  get visible(): boolean {
    return this.isVisible;
  }

  /**
   * Dispose of resources
   */
  dispose(): void {
    this.hide();
  }
}
