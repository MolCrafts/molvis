import {
  type ArcRotateCamera,
  Color3,
  type Engine,
  type LinesMesh,
  type Mesh,
  MeshBuilder,
  type Scene,
  Vector3,
} from "@babylonjs/core";
import { GridMaterial } from "@babylonjs/materials";

interface ReferenceLinesWithStorage extends LinesMesh {
  _xLine?: LinesMesh;
  _yLine?: LinesMesh;
}

/**
 * GridGround component that creates an adaptive grid ground
 * The grid automatically adjusts its density based on camera distance
 */
export class GridGround {
  private _scene: Scene;
  private _camera: ArcRotateCamera;
  private _engine: Engine;
  private _ground: Mesh | null = null;
  private _gridMaterial: GridMaterial;
  private _referenceLines: ReferenceLinesWithStorage | null = null;
  private _isEnabled = false;

  // Grid configuration
  private readonly TARGET_PX_PER_MINOR = 64;
  private readonly GRID_SUBDIVISIONS = 1;
  private MIN_GRID_STEP = 1; // Minimum grid step when camera is close
  private DISTANCE_THRESHOLD = 50; // Distance threshold for locking grid step

  // Infinite grid settings
  private readonly GRID_SIZE_MULTIPLIER = 100; // Grid extends 100x camera distance
  private _currentGridSize = 10000;

  // Smooth transition state
  private _currentGridRatio = 1;
  private _targetGridRatio = 1;
  private readonly TRANSITION_SPEED = 0.15; // Lerp factor for smooth transitions

  constructor(scene: Scene, camera: ArcRotateCamera, engine: Engine) {
    this._scene = scene;
    this._camera = camera;
    this._engine = engine;
    this._gridMaterial = this._createGridMaterial();
  }

  /**
   * Create the grid material with beautiful modern settings
   */
  private _createGridMaterial(): GridMaterial {
    const grid = new GridMaterial("grid", this._scene);

    // Rendering settings
    grid.disableDepthWrite = true;
    grid.zOffset = -1;
    grid.backFaceCulling = false;

    // Draw only the grid lines — discard the area between them so the ground
    // is fully transparent (without this, `mainColor` fills every gap and the
    // grid renders as an opaque grey sheet, since `opacity < 1` only scales
    // the whole plane rather than cutting out the background).
    grid.linesOnly = true;

    // Line colour. In linesOnly mode `mainColor` no longer fills the gaps, but
    // it is still mixed in on anti-aliased line edges, so keep it dark to avoid
    // a pale fringe.
    grid.mainColor = new Color3(0.12, 0.12, 0.14);
    grid.lineColor = new Color3(0.35, 0.4, 0.45); // Subtle blue-gray lines

    // In linesOnly mode this scales the maximum line alpha.
    grid.opacity = 0.95;
    grid.majorUnitFrequency = 10;
    grid.minorUnitVisibility = 0.45; // More subtle minor lines

    // Edge fade effect for depth
    grid.useMaxLine = true;
    grid.gridOffset = new Vector3(0, 0, 0.01); // Slightly lift grid to prevent z-fighting

    return grid;
  }

  /**
   * Enable the grid ground
   */
  public enable(): void {
    if (this._isEnabled) return;

    this._createGround();
    this._setupAdaptiveGrid();
    this._isEnabled = true;
  }

  /**
   * Disable the grid ground
   */
  public disable(): void {
    if (!this._isEnabled) return;

    if (this._ground) {
      this._ground.dispose();
      this._ground = null;
    }

    if (this._referenceLines) {
      // Dispose both X and Y reference lines
      const xLine = this._referenceLines._xLine;
      const yLine = this._referenceLines._yLine;

      if (xLine) {
        xLine.dispose();
      }
      if (yLine) {
        yLine.dispose();
      }

      this._referenceLines.dispose();
      this._referenceLines = null;
    }

    this._isEnabled = false;
  }

  /**
   * Create the ground mesh (dynamically sized for infinite appearance).
   * Base mesh is XZ; rotate into XY so Z is the world up axis.
   */
  private _createGround(): void {
    this._ground = MeshBuilder.CreateGround(
      "gridGround",
      {
        width: this._currentGridSize,
        height: this._currentGridSize,
        subdivisions: this.GRID_SUBDIVISIONS,
      },
      this._scene,
    );

    this._ground.rotation.x = Math.PI / 2;
    this._ground.material = this._gridMaterial;
    this._ground.renderingGroupId = 0; // Render behind other objects
    this._ground.isPickable = false;

    // Create reference lines (x=0 and y=0)
    this._createReferenceLines();
  }

  /**
   * Create subtle reference lines for x=0 and y=0 that blend with the grid
   */
  private _createReferenceLines(): void {
    if (this._referenceLines) {
      const xLine = this._referenceLines._xLine;
      const yLine = this._referenceLines._yLine;
      if (xLine) xLine.dispose();
      if (yLine) yLine.dispose();
      this._referenceLines.dispose();
    }

    const halfSize = this._currentGridSize / 2;

    // Create X axis reference line (y=0) - pure red
    const xLine = MeshBuilder.CreateLines(
      "xReferenceLine",
      {
        points: [
          new Vector3(-halfSize, 0, 0.001),
          new Vector3(halfSize, 0, 0.001),
        ],
        updatable: false,
      },
      this._scene,
    );
    xLine.color = new Color3(1.0, 0.0, 0.0); // Pure red
    xLine.isPickable = false;
    xLine.renderingGroupId = 0; // Same layer as grid for better blending
    xLine.alpha = 0.6; // Semi-transparent

    // Create Y axis reference line (x=0) - pure green
    const yLine = MeshBuilder.CreateLines(
      "yReferenceLine",
      {
        points: [
          new Vector3(0, -halfSize, 0.001),
          new Vector3(0, halfSize, 0.001),
        ],
        updatable: false,
      },
      this._scene,
    );
    yLine.color = new Color3(0.0, 1.0, 0.0); // Pure green
    yLine.isPickable = false;
    yLine.renderingGroupId = 0; // Same layer as grid for better blending
    yLine.alpha = 0.6; // Semi-transparent

    // Store lines for later disposal
    this._referenceLines = xLine as ReferenceLinesWithStorage;
    this._referenceLines._xLine = xLine;
    this._referenceLines._yLine = yLine;
  }

  /**
   * Setup adaptive grid that adjusts based on camera distance
   */
  private _setupAdaptiveGrid(): void {
    this._scene.onAfterRenderObservable.add(() => {
      if (!this._isEnabled || !this._ground) return;

      this._updateGridDensity();
    });
  }

  /**
   * Update grid density and size based on camera position (infinite grid effect)
   */
  private _updateGridDensity(): void {
    if (!this._ground) return;

    const renderHeight = this._engine.getRenderHeight(true);
    const cameraRadius = this._camera.radius;

    // Dynamically size grid based on camera distance for infinite appearance
    const targetSize = Math.max(cameraRadius * this.GRID_SIZE_MULTIPLIER, 1000);

    // Only recreate grid if size changed significantly (avoid constant recreation)
    if (
      Math.abs(targetSize - this._currentGridSize) >
      this._currentGridSize * 0.5
    ) {
      this._currentGridSize = targetSize;
      // Dispose and recreate with new size
      this._ground.dispose();
      if (this._referenceLines) {
        const xLine = this._referenceLines._xLine;
        const yLine = this._referenceLines._yLine;
        if (xLine) xLine.dispose();
        if (yLine) yLine.dispose();
        this._referenceLines.dispose();
        this._referenceLines = null;
      }
      this._createGround();
    }

    // Keep grid centered on camera target in XY (Z-up world).
    const target = this._camera.target;
    this._ground.position.x = target.x;
    this._ground.position.y = target.y;
    this._ground.position.z = 0;

    // Handle both perspective and orthographic cameras
    let worldPerPixel: number;

    if (this._camera.mode === 1) {
      // Orthographic camera
      if (this._camera.orthoRight !== null && this._camera.orthoLeft !== null) {
        const worldWidth = this._camera.orthoRight - this._camera.orthoLeft;
        worldPerPixel = worldWidth / renderHeight;
      } else {
        const fov = this._camera.fov;
        const dist = cameraRadius;
        const height = 2 * dist * Math.tan(fov / 2);
        const aspect = this._engine.getAspectRatio(this._camera);
        const width = height * aspect;
        worldPerPixel = width / renderHeight;
      }
    } else {
      // Perspective camera
      const fov = this._camera.fov;
      const z = cameraRadius;

      // Smooth fog transition based on grid size
      this._scene.fogStart = z * 0.5;
      this._scene.fogEnd = this._currentGridSize * 0.5;

      // Check if camera is close enough to lock grid step
      if (z <= this.DISTANCE_THRESHOLD) {
        this._targetGridRatio = this.MIN_GRID_STEP;
        this._gridMaterial.majorUnitFrequency = 1;
      } else {
        worldPerPixel = (2 * z * Math.tan(fov / 2)) / renderHeight;

        // Calculate optimal grid step size
        const desiredWorldStep = worldPerPixel * this.TARGET_PX_PER_MINOR;

        // Find best grid step from available scales
        const scales = [1, 2, 5];
        const pow10 = 10 ** Math.floor(Math.log10(desiredWorldStep));
        let best = scales[0] * pow10;

        for (const s of scales) {
          const candidate = s * pow10;
          if (
            Math.abs(candidate - desiredWorldStep) <
            Math.abs(best - desiredWorldStep)
          ) {
            best = candidate;
          }
        }

        // Ensure grid step is never smaller than minimum
        best = Math.max(best, this.MIN_GRID_STEP);
        this._targetGridRatio = best;
        this._gridMaterial.majorUnitFrequency = 10;
      }
    }

    // Smooth interpolation to target grid ratio
    this._currentGridRatio +=
      (this._targetGridRatio - this._currentGridRatio) * this.TRANSITION_SPEED;

    // Snap to target if very close
    if (Math.abs(this._targetGridRatio - this._currentGridRatio) < 0.01) {
      this._currentGridRatio = this._targetGridRatio;
    }

    // Apply smoothed ratio
    this._gridMaterial.gridRatio = this._currentGridRatio;
  }

  /**
   * Update grid settings (appearance + behavior)
   */
  public update(config: {
    enabled?: boolean;
    mainColor?: string;
    lineColor?: string;
    opacity?: number;
    majorUnitFrequency?: number;
    minorUnitVisibility?: number;
    size?: number;
  }): void {
    if (config.enabled !== undefined) {
      if (config.enabled) this.enable();
      else this.disable();
    }

    if (config.mainColor) {
      this._gridMaterial.mainColor = Color3.FromHexString(config.mainColor);
    }
    if (config.lineColor) {
      this._gridMaterial.lineColor = Color3.FromHexString(config.lineColor);
    }
    if (config.opacity !== undefined) {
      this._gridMaterial.opacity = config.opacity;
    }
    if (config.majorUnitFrequency !== undefined) {
      this._gridMaterial.majorUnitFrequency = config.majorUnitFrequency;
    }
    if (config.minorUnitVisibility !== undefined) {
      this._gridMaterial.minorUnitVisibility = config.minorUnitVisibility;
    }

    // Size changes set minimum grid size (grid will auto-expand)
    if (config.size !== undefined && config.size !== this._currentGridSize) {
      this.setSize(config.size, config.size);
    }
  }

  /**
   * Set minimum grid size (grid will auto-expand beyond this based on camera)
   */
  public setSize(width: number, height: number): void {
    const minSize = Math.max(width, height);

    // Set current size but allow dynamic expansion
    if (this._currentGridSize < minSize) {
      this._currentGridSize = minSize;

      if (this._ground) {
        this._ground.dispose();
        if (this._referenceLines) {
          const xLine = this._referenceLines._xLine;
          const yLine = this._referenceLines._yLine;
          if (xLine) xLine.dispose();
          if (yLine) yLine.dispose();
          this._referenceLines.dispose();
          this._referenceLines = null;
        }
        this._createGround();
      }
    }
  }

  /**
   * Check if grid is enabled
   */
  public get isEnabled(): boolean {
    return this._isEnabled;
  }

  /**
   * Dispose of the grid ground
   */
  public dispose(): void {
    this.disable();
    if (this._gridMaterial) {
      this._gridMaterial.dispose();
    }
    if (this._referenceLines) {
      // Dispose both X and Y reference lines
      const xLine = this._referenceLines._xLine;
      const yLine = this._referenceLines._yLine;

      if (xLine) {
        xLine.dispose();
      }
      if (yLine) {
        yLine.dispose();
      }

      this._referenceLines.dispose();
      this._referenceLines = null;
    }
  }
}
