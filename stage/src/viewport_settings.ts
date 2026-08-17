import type { Scene } from "@babylonjs/core";
import { ArcRotateCamera, Color4 } from "@babylonjs/core";

/**
 * Viewport configuration settings
 */
export interface ViewportConfig {
  backgroundColor: Color4;
  isPerspective: boolean;
  fieldOfView: number;
  nearClipPlane: number;
  farClipPlane: number;
  showAxes: boolean;
  showGrid: boolean;
}

/**
 * Default viewport configuration
 */
export const DEFAULT_VIEWPORT_CONFIG: ViewportConfig = {
  backgroundColor: new Color4(0.1, 0.1, 0.1, 1.0), // Dark gray
  isPerspective: true,
  fieldOfView: 0.8, // ~45 degrees
  nearClipPlane: 0.1,
  farClipPlane: 1000,
  showAxes: true,
  showGrid: false,
};

/**
 * Manages viewport configuration and settings
 */
export class ViewportSettings {
  private config: ViewportConfig;
  private camera: ArcRotateCamera;

  constructor(
    _scene: Scene,
    camera: ArcRotateCamera,
    initialConfig?: Partial<ViewportConfig>,
  ) {
    this.camera = camera;
    this.config = { ...DEFAULT_VIEWPORT_CONFIG, ...initialConfig };
    this.applyConfig();
  }

  /**
   * Apply current configuration to scene and camera
   */
  private applyConfig(): void {
    // Apply current configuration to scene and camera
    // Note: clearColor removed to use Babylon.js default background

    // Camera mode (perspective/orthographic)
    this.camera.mode = this.config.isPerspective
      ? ArcRotateCamera.PERSPECTIVE_CAMERA
      : ArcRotateCamera.ORTHOGRAPHIC_CAMERA;

    // Field of view
    this.camera.fov = this.config.fieldOfView;

    // Clipping planes
    this.camera.minZ = this.config.nearClipPlane;
    this.camera.maxZ = this.config.farClipPlane;
  }

  /**
   * Toggle between perspective and orthographic camera
   */
  togglePerspective(): void {
    this.config.isPerspective = !this.config.isPerspective;
    this.camera.mode = this.config.isPerspective
      ? ArcRotateCamera.PERSPECTIVE_CAMERA
      : ArcRotateCamera.ORTHOGRAPHIC_CAMERA;
  }

  /**
   * Set perspective mode
   */
  setPerspective(isPerspective: boolean): void {
    this.config.isPerspective = isPerspective;
    this.camera.mode = isPerspective
      ? ArcRotateCamera.PERSPECTIVE_CAMERA
      : ArcRotateCamera.ORTHOGRAPHIC_CAMERA;
  }

  /**
   * Set field of view (in radians)
   */
  setFieldOfView(fov: number): void {
    this.config.fieldOfView = Math.max(0.1, Math.min(Math.PI, fov));
    this.camera.fov = this.config.fieldOfView;
  }

  /**
   * Set field of view in degrees
   */
  setFieldOfViewDegrees(degrees: number): void {
    this.setFieldOfView((degrees * Math.PI) / 180);
  }

  /**
   * Set near clipping plane
   */
  setNearClipPlane(distance: number): void {
    this.config.nearClipPlane = Math.max(0.01, distance);
    this.camera.minZ = this.config.nearClipPlane;
  }

  /**
   * Set far clipping plane
   */
  setFarClipPlane(distance: number): void {
    this.config.farClipPlane = Math.max(
      this.config.nearClipPlane + 1,
      distance,
    );
    this.camera.maxZ = this.config.farClipPlane;
  }

  /**
   * Toggle axes visibility
   */
  toggleAxes(): void {
    this.config.showAxes = !this.config.showAxes;
  }

  /**
   * Toggle grid visibility
   */
  toggleGrid(): void {
    this.config.showGrid = !this.config.showGrid;
  }

  /**
   * Get current configuration
   */
  getConfig(): Readonly<ViewportConfig> {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(updates: Partial<ViewportConfig>): void {
    this.config = { ...this.config, ...updates };
    this.applyConfig();
  }

  /**
   * Reset to default configuration
   */
  reset(): void {
    this.config = { ...DEFAULT_VIEWPORT_CONFIG };
    this.applyConfig();
  }
}
