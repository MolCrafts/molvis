import type { AbstractMesh, PointerInfo } from "@babylonjs/core";
import {
  Color3,
  Mesh,
  MeshBuilder,
  StandardMaterial,
  Vector3,
} from "@babylonjs/core";
import { WasmArray } from "@molcrafts/molrs";
import type { MolvisApp as Molvis } from "../app";
import { makeSelectionKey } from "../selection_manager";
import { ContextMenuController } from "../ui/menus/controller";
import { BaseMode, ModeType } from "./base";
import { CommonMenuItems } from "./menu_items";
import type { BindingEvent, HitResult, MenuItem } from "./types";

interface MeasurementData {
  id: string;
  type: "distance" | "angle" | "dihedral";
  atoms: number[]; // Store Atom Semantic IDs
  visuals: AbstractMesh[];
  value: number;
}

interface BufferItem {
  id: number; // Semantic Atom ID
  key: string; // Selection Key
  /** Render index into the atom impostor pool (`instanceData`). */
  thinIndex: number;
  position: Vector3; // Cached display position (matches impostor center)
  label: string;
}

/** World-space dash / gap lengths (Å). Fixed so short bonds stay readable. */
const MEASURE_DASH_LEN = 0.18;
const MEASURE_GAP_LEN = 0.12;
/** Tube radius (Å) for the dashed connector — thick enough to read at typical zoom. */
const MEASURE_LINE_RADIUS = 0.045;

/**
 * Context menu controller for Measure mode.
 */
class MeasureModeContextMenu extends ContextMenuController {
  constructor(
    app: Molvis,
    private mode: MeasureMode,
  ) {
    super(app, "molvis-measure-menu");
  }

  protected shouldShowMenu(
    _hit: HitResult | null,
    isDragging: boolean,
  ): boolean {
    return !isDragging;
  }

  protected buildMenuItems(_hit: HitResult | null): MenuItem[] {
    const items: MenuItem[] = [
      {
        type: "binding",
        bindingConfig: {
          view: "list",
          label: "Distance Unit",
          options: [
            { text: "Angstrom (Å)", value: "angstrom" },
            { text: "Nanometer (nm)", value: "nanometer" },
            { text: "Picometer (pm)", value: "picometer" },
          ],
          value: this.mode.distanceUnit,
        },
        action: (ev: BindingEvent) => {
          this.mode.distanceUnit = String(ev.value);
          this.mode.updateAllLabels();
        },
      },
      {
        type: "binding",
        bindingConfig: {
          view: "list",
          label: "Angle Unit",
          options: [
            { text: "Degrees (°)", value: "degrees" },
            { text: "Radians (rad)", value: "radians" },
          ],
          value: this.mode.angleUnit,
        },
        action: (ev: BindingEvent) => {
          this.mode.angleUnit = String(ev.value);
          this.mode.updateAllLabels();
        },
      },
      {
        type: "binding",
        bindingConfig: {
          label: "Precision",
          min: 1,
          max: 6,
          step: 1,
          value: this.mode.precision,
        },
        action: (ev: BindingEvent) => {
          this.mode.precision = Number(ev.value);
          this.mode.updateAllLabels();
        },
      },
      { type: "separator" },
      {
        type: "button",
        title: "Clear All Measurements",
        action: () => {
          this.mode.clearAllMeasurements();
        },
      },
      { type: "separator" },
    ];
    return CommonMenuItems.appendCommonTail(items, this.app);
  }
}

class MeasureMode extends BaseMode {
  private measurements: Map<string, MeasurementData> = new Map();
  // Selection buffer for sequential measurement (max 4 atoms)
  private selectionBuffer: BufferItem[] = [];

  // Configuration properties
  public distanceUnit = "angstrom";
  public angleUnit = "degrees";
  public precision = 2;

  constructor(app: Molvis) {
    super(ModeType.Measure, app);
  }

  protected createContextMenuController(): ContextMenuController {
    return new MeasureModeContextMenu(this.app, this);
  }

  public override start(): void {
    super.start();
    // Clear any existing selection to start fresh
    this.app.world.selectionManager.apply({ type: "clear" });
    this.app.world.highlighter.invalidateAndRebuild();
  }

  public override finish(): void {
    this.clearAllMeasurements();
    this.app.world.selectionManager.apply({ type: "clear" });
    super.finish();
  }

  protected override async _on_left_up(
    pointerInfo: PointerInfo,
  ): Promise<void> {
    if (this._is_dragging) {
      await super._on_left_up(pointerInfo);
      return;
    }

    const hit = await this.pickHit();

    if (hit && hit.type === "atom") {
      this.handleAtomClick(hit);
    } else {
      // Clear All on Empty Click
      this.clearAllMeasurements();
    }

    await super._on_left_up(pointerInfo);
  }

  private handleAtomClick(hit: Extract<HitResult, { type: "atom" }>): void {
    const thinIndex = hit.thinInstanceIndex;
    const meshId = hit.mesh.uniqueId;

    // Prefer pick metadata (already resolved by the id-pass picker); fall
    // back to a registry lookup only if the hit arrived without it.
    const meta =
      hit.metadata?.type === "atom"
        ? hit.metadata
        : thinIndex >= 0
          ? this.world.sceneIndex.getMeta(meshId, thinIndex)
          : this.world.sceneIndex.getMeta(meshId);

    if (meta?.type !== "atom") {
      return;
    }

    const atomId = meta.atomId;

    // Repetitive click check
    if (this.selectionBuffer.length > 0) {
      const last = this.selectionBuffer[this.selectionBuffer.length - 1];
      if (last.id === atomId) return;
    }

    // Auto-reset if 4 atoms already selected (start fresh with new atom)
    if (this.selectionBuffer.length >= 4) {
      this.clearAllMeasurements();
    }

    // Authoritative display position = impostor instanceData (what the
    // shader draws). Meta.position is the same at frame load, but the GPU
    // buffer is the single source of truth after position-only updates.
    const position = this.resolveAtomPosition(thinIndex, meta.position);
    if (!position) return;

    const label = meta.element;
    const selectionKey = makeSelectionKey(
      meshId,
      thinIndex >= 0 ? thinIndex : undefined,
    );

    const item: BufferItem = {
      id: atomId,
      key: selectionKey,
      thinIndex,
      position,
      label,
    };

    // Add to buffer
    this.selectionBuffer.push(item);

    // Highlight using SelectionManager
    this.app.world.selectionManager.apply({
      type: "add",
      atoms: [selectionKey],
    });

    // Trigger Measurements
    this.processBuffer();
  }

  /**
   * World-space center of the rendered atom impostor.
   * Prefer the live `instanceData` buffer so the dashed line anchors on
   * the same coordinates the shader uses (`centerWorld = instanceData.xyz`).
   */
  private resolveAtomPosition(
    thinIndex: number,
    fallback: { x: number; y: number; z: number },
  ): Vector3 {
    if (thinIndex >= 0) {
      const atomState = this.world.sceneIndex.meshRegistry.getAtomState();
      const data = atomState?.buffers.get("instanceData");
      if (data) {
        const o = thinIndex * data.stride;
        if (o + 2 < data.data.length) {
          return new Vector3(data.data[o], data.data[o + 1], data.data[o + 2]);
        }
      }
    }
    return new Vector3(fallback.x, fallback.y, fallback.z);
  }

  /**
   * Displacement `b - a` honouring the frame's simulation box when present.
   * Uses WASM `Box.delta(..., minimum_image = true)` so triclinic cells and
   * partial-PBC flags match the bond renderer. Without a box (or on failure)
   * falls back to the raw Euclidean vector between the display positions.
   */
  private measureDisplacement(a: Vector3, b: Vector3): Vector3 {
    const box = this.app.system.frame.box;
    if (!box) return b.subtract(a);

    const aBuf = new Float64Array([a.x, a.y, a.z]);
    const bBuf = new Float64Array([b.x, b.y, b.z]);
    const shape = new Uint32Array([1, 3]);
    const aArr = WasmArray.from(aBuf, shape);
    const bArr = WasmArray.from(bBuf, shape);
    try {
      const delta = box.delta(aArr, bArr, true);
      try {
        const d = delta.toTypedArray();
        return new Vector3(d[0], d[1], d[2]);
      } finally {
        delta.free();
      }
    } catch {
      return b.subtract(a);
    } finally {
      aArr.free();
      bArr.free();
    }
  }

  private processBuffer() {
    const n = this.selectionBuffer.length;
    if (n < 2) return;

    // Always measure distance between last two
    const last = this.selectionBuffer[n - 1];
    const secondLast = this.selectionBuffer[n - 2];
    this.createDistanceMeasurement(secondLast, last);

    // Measure Angle if >= 3 (A-B-C)
    if (n >= 3) {
      const c = this.selectionBuffer[n - 1];
      const b = this.selectionBuffer[n - 2];
      const a = this.selectionBuffer[n - 3];
      this.createAngleMeasurement(a, b, c);
    }

    // Measure Dihedral if >= 4 (A-B-C-D)
    if (n >= 4) {
      const d = this.selectionBuffer[n - 1];
      const c = this.selectionBuffer[n - 2];
      const b = this.selectionBuffer[n - 3];
      const a = this.selectionBuffer[n - 4];
      this.createDihedralMeasurement(a, b, c, d);
    }

    this.updateInfoPanel();
  }

  private clearSelectionBuffer(): void {
    // Clear Visuals
    this.app.world.selectionManager.apply({ type: "clear" });
    this.selectionBuffer = [];
  }

  // Override to prevent BaseMode from overwriting our measurement info with default hover text
  // BUT we now add hover highlighting via Highlighter
  // Override to prevent BaseMode from overwriting our measurement info with default hover text
  // BUT we now add hover highlighting via Highlighter
  override async _on_pointer_move(_pointerInfo: PointerInfo): Promise<void> {
    const hit = await this.pickHit();

    if (this.enableHoverHighlight) {
      if (hit && hit.type === "atom" && hit.mesh) {
        const thinIndex = hit.thinInstanceIndex ?? -1;
        const key = makeSelectionKey(
          hit.mesh.uniqueId,
          thinIndex >= 0 ? thinIndex : undefined,
        );
        this.app.world.highlighter.highlightPreview([key]);
      } else {
        this.app.world.highlighter.highlightPreview([]);
      }
    }
  }

  // --- Measurement Creation ---

  private createDistanceMeasurement(start: BufferItem, end: BufferItem): void {
    // Measure along the minimum-image displacement when a simbox is present
    // (matches bond rendering). The line is drawn from the displayed start
    // atom to `start + delta`, which is the image of `end` used for the value.
    const delta = this.measureDisplacement(start.position, end.position);
    const distance = delta.length();
    const id = `measure_${Date.now()}_dist`;

    const lineEnd = start.position.add(delta);
    const line = this.createMeasurementLine(start.position, lineEnd);

    const measurement: MeasurementData = {
      id,
      type: "distance",
      atoms: [start.id, end.id],
      visuals: [line],
      value: distance,
    };

    this.measurements.set(id, measurement);
  }

  private createAngleMeasurement(
    a: BufferItem,
    b: BufferItem,
    c: BufferItem,
  ): void {
    // Vectors from the vertex, MI-aware so angles across periodic boundaries
    // match the same convention as distance. Visuals are owned by the
    // intervening distance measurements (A–B, B–C).
    const vBA = this.measureDisplacement(b.position, a.position).normalize();
    const vBC = this.measureDisplacement(b.position, c.position).normalize();

    const dot = Vector3.Dot(vBA, vBC);
    const angleRad = Math.acos(Math.max(-1, Math.min(1, dot)));

    const id = `measure_${Date.now()}_ang`;

    const measurement: MeasurementData = {
      id,
      type: "angle",
      atoms: [a.id, b.id, c.id],
      visuals: [],
      value: angleRad,
    };

    this.measurements.set(id, measurement);
  }

  private createDihedralMeasurement(
    a: BufferItem,
    b: BufferItem,
    c: BufferItem,
    d: BufferItem,
  ): void {
    // Chain of MI displacements so each bond leg is the short image.
    const b1 = this.measureDisplacement(a.position, b.position);
    const b2 = this.measureDisplacement(b.position, c.position);
    const b3 = this.measureDisplacement(c.position, d.position);

    const b2Norm = b2.length();
    if (b2Norm < 1e-6) return;

    const n1 = Vector3.Cross(b1, b2).normalize();
    const n2 = Vector3.Cross(b2, b3).normalize();
    const m1 = Vector3.Cross(n1, b2.scale(1 / b2Norm)).normalize();

    const x = Vector3.Dot(n1, n2);
    const y = Vector3.Dot(m1, n2);

    const angleRad = Math.atan2(y, x);

    const id = `measure_${Date.now()}_dihedral`;

    const measurement: MeasurementData = {
      id,
      type: "dihedral",
      atoms: [a.id, b.id, c.id, d.id],
      visuals: [],
      value: angleRad,
    };

    this.measurements.set(id, measurement);
  }

  /**
   * Build a dashed connector whose endpoints land exactly on `start` / `end`.
   *
   * Uses short tubes (not `CreateDashedLines`) so:
   * - endpoints cover the full interval (no residual gap at the far end)
   * - the stroke has real world-space thickness (LinesMesh is 1 px and hard to see)
   */
  private createMeasurementLine(start: Vector3, end: Vector3): AbstractMesh {
    const segments = buildDashedLineSegments(
      start,
      end,
      MEASURE_DASH_LEN,
      MEASURE_GAP_LEN,
    );
    const scene = this.world.scene;
    const root = new Mesh("measurement_line", scene);
    root.isPickable = false;
    root.alwaysSelectAsActiveMesh = true;
    root.renderingGroupId = 1;

    const mat = new StandardMaterial("measurement_line_mat", scene);
    mat.emissiveColor = new Color3(1, 1, 0);
    mat.disableLighting = true;
    mat.alpha = 0.95;
    // Parent owns the material; disposing root cleans children + mat.
    root.material = mat;

    for (let i = 0; i < segments.length; i++) {
      const [a, b] = segments[i];
      if (Vector3.DistanceSquared(a, b) < 1e-12) continue;
      const tube = MeshBuilder.CreateTube(
        `measurement_dash_${i}`,
        {
          path: [a, b],
          radius: MEASURE_LINE_RADIUS,
          tessellation: 6,
          cap: Mesh.CAP_ALL,
        },
        scene,
      );
      tube.material = mat;
      tube.isPickable = false;
      tube.parent = root;
      tube.renderingGroupId = 1;
    }

    return root;
  }

  private updateInfoPanel(): void {
    if (this.measurements.size === 0) {
      this.app.events.emit("info-text-change", "");
      return;
    }

    const dists: string[] = [];
    const angles: string[] = [];
    const dihedrals: string[] = [];

    // Prioritize newest (map handles insertion order)
    for (const m of this.measurements.values()) {
      const str = this.formatMeasurement(m);
      if (m.type === "distance") dists.push(str);
      else if (m.type === "angle") angles.push(str);
      else if (m.type === "dihedral") dihedrals.push(str);
    }

    // "3+2+1" Rule (Show Last N)
    const showDists = dists.slice(-3).reverse();
    const showAngles = angles.slice(-2).reverse();
    const showDihedrals = dihedrals.slice(-1).reverse();

    const sections: string[] = [];
    if (showDihedrals.length > 0) sections.push(...showDihedrals);
    if (showAngles.length > 0) sections.push(...showAngles);
    if (showDists.length > 0) sections.push(...showDists);

    const infoText = `Active Measurements:\n${sections.join("\n")}`;
    this.app.events.emit("info-text-change", infoText);
  }

  private formatMeasurement(m: MeasurementData): string {
    const ids = m.atoms.map((id) => `Atom ${id}`);
    if (m.type === "distance") {
      return `${ids[0]} - ${ids[1]}: ${this.formatDistance(m.value)}`;
    }
    if (m.type === "angle") {
      return `${ids[0]} - ${ids[1]} - ${ids[2]}: ${this.formatAngle(m.value)}`;
    }
    if (m.type === "dihedral") {
      return `${ids[0]} - ${ids[1]} - ${ids[2]} - ${ids[3]}: ${this.formatAngle(m.value)}`;
    }
    return "";
  }

  private formatDistance(distance: number): string {
    let convertedDistance = distance;
    let unitSymbol = "Å";

    switch (this.distanceUnit) {
      case "nanometer":
        convertedDistance = distance / 10;
        unitSymbol = "nm";
        break;
      case "picometer":
        convertedDistance = distance * 100;
        unitSymbol = "pm";
        break;
      default: // angstrom
        unitSymbol = "Å";
        break;
    }

    return `${convertedDistance.toFixed(this.precision)} ${unitSymbol}`;
  }

  private formatAngle(radians: number): string {
    if (this.angleUnit === "degrees") {
      const deg = radians * (180 / Math.PI);
      return `${deg.toFixed(this.precision)}°`;
    }
    return `${radians.toFixed(this.precision)} rad`;
  }

  public updateAllLabels(): void {
    this.updateInfoPanel();
  }

  public clearAllMeasurements(): void {
    for (const measurement of this.measurements.values()) {
      for (const v of measurement.visuals) {
        v.dispose();
      }
    }
    this.measurements.clear();
    this.clearSelectionBuffer();
    this.app.events.emit("info-text-change", "");
  }

  protected override _on_press_escape(): void {
    if (this.selectionBuffer.length > 0) {
      this.clearSelectionBuffer();
    } else {
      this.clearAllMeasurements();
    }
  }
}

/**
 * Split `[start, end]` into solid dash segments of fixed world length.
 * The final dash always reaches `end` so the visual anchors land exactly
 * on the measured points (unlike Babylon's count-based CreateDashedLines).
 */
function buildDashedLineSegments(
  start: Vector3,
  end: Vector3,
  dashLen: number,
  gapLen: number,
): Vector3[][] {
  const dir = end.subtract(start);
  const total = dir.length();
  if (total < 1e-8) return [[start.clone(), end.clone()]];

  const unit = dir.scale(1 / total);
  const segments: Vector3[][] = [];
  let cursor = 0;
  while (cursor < total - 1e-8) {
    const dashEnd = Math.min(cursor + dashLen, total);
    segments.push([
      start.add(unit.scale(cursor)),
      start.add(unit.scale(dashEnd)),
    ]);
    if (dashEnd >= total - 1e-8) break;
    cursor = dashEnd + gapLen;
  }
  // Guarantee the far endpoint is present even if a gap would have eaten it.
  if (segments.length === 0) {
    segments.push([start.clone(), end.clone()]);
  } else {
    const last = segments[segments.length - 1][1];
    if (Vector3.DistanceSquared(last, end) > 1e-10) {
      segments.push([last.clone(), end.clone()]);
    }
  }
  return segments;
}

export { MeasureMode };
