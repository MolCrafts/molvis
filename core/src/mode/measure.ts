import type { PointerInfo, AbstractMesh, Vector3 } from "@babylonjs/core";
import { MeshBuilder, StandardMaterial, Color3 } from "@babylonjs/core";
import { Pane } from "tweakpane";
import { BaseMode, ModeType } from "./base";
import type { Molvis } from "@molvis/core";

interface MeasurementData {
  id: string;
  startAtom: AbstractMesh;
  endAtom: AbstractMesh;
  line: AbstractMesh;
  distance: number;
}

class MeasureModeMenu {
  private container: HTMLDivElement | null = null;
  private pane: Pane | null = null;
  private containerId: string;
  private isBuilt = false;

  constructor(private measureMode: MeasureMode) {
    this.containerId = "molvis-measure-menu";
  }

  private build() {
    const existingContainer = this.measureMode.molvisApp.uiContainer?.querySelector(`#${this.containerId}`) as HTMLDivElement;
    
    if (existingContainer) {
      this.container = existingContainer;
      if (this.pane) {
        this.pane.dispose();
      }
    } else {
      this.container = document.createElement("div");
      this.container.id = this.containerId;
      this.container.className = "MolvisModeMenu";
      this.container.style.position = "fixed";
      this.container.style.zIndex = "9999";
      this.container.style.pointerEvents = "auto";
      
      if (this.measureMode.molvisApp.uiContainer) {
        this.measureMode.molvisApp.uiContainer.appendChild(this.container);
      }
    }
    
    this.pane = new Pane({ container: this.container, title: "Measurement" });
    this.pane.hidden = true;
    this.buildMenuContent();
    this.isBuilt = true;
  }

  private buildMenuContent() {
    if (!this.pane) return;

    // Unit selection
    this.pane.addBinding(this.measureMode, "unit", {
      view: "list",
      label: "Unit",
      options: [
        { text: "Angstrom (Å)", value: "angstrom" },
        { text: "Nanometer (nm)", value: "nanometer" },
        { text: "Picometer (pm)", value: "picometer" }
      ]
    }).on('change', () => {
      this.measureMode.updateAllLabels();
    });

    // Precision control
    this.pane.addBinding(this.measureMode, "precision", {
      label: "Precision",
      min: 1,
      max: 6,
      step: 1
    }).on('change', () => {
      this.measureMode.updateAllLabels();
    });

    this.pane.addBlade({ view: 'separator' });

    // Clear all measurements
    this.pane.addButton({ title: "Clear All" }).on("click", () => {
      this.measureMode.clearAllMeasurements();
    });
  }

  public show(x: number, y: number) {
    if (!this.isBuilt) {
      this.build();
    }
    
    if (this.container && this.pane) {
      this.container.style.left = `${x}px`;
      this.container.style.top = `${y}px`;
      this.pane.hidden = false;
    }
  }

  public hide() {
    if (this.pane) {
      this.pane.hidden = true;
    }
  }

  public dispose() {
    if (this.pane) {
      this.pane.dispose();
      this.pane = null;
    }
    this.container?.parentNode?.removeChild(this.container);
    this.container = null;
    this.isBuilt = false;
  }
}

class MeasureMode extends BaseMode {
  private measurements: Map<string, MeasurementData> = new Map();
  private selectedAtom: AbstractMesh | null = null;
  private menu: MeasureModeMenu;
  
  // Configuration properties
  public unit = "angstrom";
  public precision = 2;

  constructor(app: Molvis) {
    super(ModeType.Measure, app);
    this.menu = new MeasureModeMenu(this);
  }

  public get molvisApp(): Molvis {
    return this.app;
  }

  protected showContextMenu(x: number, y: number): void {
    this.menu.show(x, y);
  }

  protected hideContextMenu(): void {
    this.menu.hide();
  }

  protected override _on_left_up(pointerInfo: PointerInfo): void {
    if (this._is_dragging) {
      super._on_left_up(pointerInfo);
      return;
    }

    const mesh = this.pick_mesh("atom");
    if (mesh?.name.startsWith("atom:")) {
      this.handleAtomClick(mesh);
    } else {
      // Click on empty space - clear current selection
      this.clearCurrentSelection();
    }

    super._on_left_up(pointerInfo);
  }

  private handleAtomClick(atom: AbstractMesh): void {
    if (!this.selectedAtom) {
      // First atom selection
      this.selectAtom(atom);
    } else if (this.selectedAtom === atom) {
      // Same atom clicked - deselect
      this.clearCurrentSelection();
    } else {
      // Second atom selected - create measurement
      this.createMeasurement(this.selectedAtom, atom);
      this.clearCurrentSelection();
    }
  }

  private selectAtom(atom: AbstractMesh): void {
    this.selectedAtom = atom;
    this.highlightAtom(atom, true);
  }

  private clearCurrentSelection(): void {
    if (this.selectedAtom) {
      this.highlightAtom(this.selectedAtom, false);
      this.selectedAtom = null;
    }
  }

  private highlightAtom(atom: AbstractMesh, highlight: boolean): void {
    const material = atom.material as StandardMaterial;
    if (material) {
      if (highlight) {
        material.emissiveColor = new Color3(0.3, 0.3, 0.1);
        material.specularColor = new Color3(1, 1, 1);
      } else {
        material.emissiveColor = new Color3(0, 0, 0);
        material.specularColor = new Color3(0.2, 0.2, 0.2);
      }
    }
  }

  private createMeasurement(startAtom: AbstractMesh, endAtom: AbstractMesh): void {
    const distance = startAtom.position.subtract(endAtom.position).length();
    const measurementId = `measure_${Date.now()}`;

    // Create measurement line
    const line = this.createMeasurementLine(startAtom.position, endAtom.position);

    const measurement: MeasurementData = {
      id: measurementId,
      startAtom,
      endAtom,
      line,
      distance
    };

    this.measurements.set(measurementId, measurement);
    
    // Update info panel with current measurement
    this.updateInfoPanel();
  }

  private createMeasurementLine(start: Vector3, end: Vector3): AbstractMesh {
    const path = [start, end];
    const line = MeshBuilder.CreateTube("measurement_line", {
      path,
      radius: 0.02,
      updatable: true
    }, this.world.scene);

    const material = new StandardMaterial("measurement_line_mat", this.world.scene);
    material.diffuseColor = new Color3(1, 1, 0); // Yellow
    material.alpha = 0.8;
    line.material = material;

    return line;
  }

  private updateInfoPanel(): void {
    if (this.measurements.size === 0) {
      this.gui?.updateInfoText("");
      return;
    }

    const measurementTexts: string[] = [];
    let index = 1;
    
    for (const measurement of this.measurements.values()) {
      const formattedDistance = this.formatDistance(measurement.distance);
      const atomName1 = measurement.startAtom.name.split(':')[1];
      const atomName2 = measurement.endAtom.name.split(':')[1];
      measurementTexts.push(`[${index}] ${atomName1} - ${atomName2}: ${formattedDistance}`);
      index++;
    }
    
    const infoText = `Measurements (${this.measurements.size}):\n${measurementTexts.join('\n')}`;
    this.gui?.updateInfoText(infoText);
  }

  private formatDistance(distance: number): string {
    let convertedDistance = distance;
    let unitSymbol = "Å";

    switch (this.unit) {
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

  public updateAllLabels(): void {
    // Simply update the info panel with all measurements
    this.updateInfoPanel();
  }

  public clearAllMeasurements(): void {
    for (const measurement of this.measurements.values()) {
      measurement.line.dispose();
    }
    this.measurements.clear();
    this.gui?.updateInfoText("");
  }

  // Override to handle Escape key to clear current selection
  protected override _on_press_escape(): void {
    if (this.selectedAtom) {
      this.clearCurrentSelection();
    } else {
      this.clearAllMeasurements();
    }
  }

  public override finish(): void {
    this.clearAllMeasurements();
    this.clearCurrentSelection();
    
    if (this.menu) {
      this.menu.dispose();
    }
    
    super.finish();
  }

  override _on_pointer_move(_pointerInfo: PointerInfo) {
    // Show measurement preview when atom is selected
    if (this.selectedAtom) {
      const mesh = this.pick_mesh("atom");
      if (mesh?.name.startsWith("atom:") && mesh !== this.selectedAtom) {
        const distance = this.selectedAtom.position.subtract(mesh.position).length();
        const formattedDistance = this.formatDistance(distance);
        const atomName1 = this.selectedAtom.name.split(':')[1];
        const atomName2 = mesh.name.split(':')[1];
        
        // Show preview with existing measurements
        let previewText = `Preview: ${atomName1} - ${atomName2} = ${formattedDistance}`;
        if (this.measurements.size > 0) {
          const measurementTexts: string[] = [];
          let index = 1;
          
          for (const measurement of this.measurements.values()) {
            const measuredDistance = this.formatDistance(measurement.distance);
            const measuredAtomName1 = measurement.startAtom.name.split(':')[1];
            const measuredAtomName2 = measurement.endAtom.name.split(':')[1];
            measurementTexts.push(`[${index}] ${measuredAtomName1} - ${measuredAtomName2}: ${measuredDistance}`);
            index++;
          }
          
          previewText = `${previewText}\n\nExisting Measurements:\n${measurementTexts.join('\n')}`;
        }
        
        this.gui?.updateInfoText(previewText);
      } else if (!mesh) {
        // Just show existing measurements when not hovering over an atom
        this.updateInfoPanel();
      }
    } else {
      // Show normal atom/bond info or measurements
      const mesh = this.pick_mesh();
      if (mesh?.metadata) {
        // Call parent method to show atom/bond info
        super._on_pointer_move(_pointerInfo);
      } else if (this.measurements.size > 0) {
        // Show measurements when not hovering over anything
        this.updateInfoPanel();
      } else {
        // Clear info when nothing to show
        this.gui?.updateInfoText("");
      }
    }
  }
}

export { MeasureMode };
