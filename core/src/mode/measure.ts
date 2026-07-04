import type { AbstractMesh, PointerInfo } from "@babylonjs/core";
import { Color3, MeshBuilder, Vector3 } from "@babylonjs/core";
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
  position: Vector3; // Cached position
  label: string;
}

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

    const meta =
      thinIndex >= 0
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

    // Robust Position Logic
    let position: Vector3;
    if (thinIndex < 0) {
      position = hit.mesh.absolutePosition.clone();
    } else {
      // For thin instances, we assume they haven't moved individually
      position = new Vector3(meta.position.x, meta.position.y, meta.position.z);
    }

    const label = meta.element;
    const selectionKey = makeSelectionKey(
      meshId,
      thinIndex >= 0 ? thinIndex : undefined,
    );

    const item: BufferItem = {
      id: atomId,
      key: selectionKey,
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
    const distance = start.position.subtract(end.position).length();
    const id = `measure_${Date.now()}_dist`;

    const line = this.createMeasurementLine(start.position, end.position);

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
    const vBA = a.position.subtract(b.position).normalize();
    const vBC = c.position.subtract(b.position).normalize();

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
    const b1 = b.position.subtract(a.position);
    const b2 = c.position.subtract(b.position);
    const b3 = d.position.subtract(c.position);

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

  // Use Dashed Lines
  private createMeasurementLine(start: Vector3, end: Vector3): AbstractMesh {
    const points = [start, end];
    const line = MeshBuilder.CreateDashedLines(
      "measurement_line",
      {
        points,
        dashSize: 3,
        gapSize: 1,
        dashNb: 20,
      },
      this.world.scene,
    );

    // Allow picking/color through standard material?
    // CreateDashedLines returns LinesMesh which uses color property, not material.diffuseColor in the same way.
    line.color = new Color3(1, 1, 0);
    line.alpha = 0.8;

    return line;
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

export { MeasureMode };
