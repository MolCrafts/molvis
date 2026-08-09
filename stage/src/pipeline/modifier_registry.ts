import { AffineTransformationModifier } from "../modifiers/AffineTransformationModifier";
import { AssignColorModifier } from "../modifiers/AssignColorModifier";
import { CameraTrackModifier } from "../modifiers/CameraTrackModifier";
import { CenterOfMassModifier } from "../modifiers/CenterOfMassModifier";
import { ClusterModifier } from "../modifiers/ClusterModifier";
import { ColorByPropertyModifier } from "../modifiers/ColorByPropertyModifier";
import { ColorByTypeModifier } from "../modifiers/ColorByTypeModifier";
import { ComputeBondsModifier } from "../modifiers/ComputeBondsModifier";
import { ComputePropertyModifier } from "../modifiers/ComputePropertyModifier";
import { ConstructSurfaceMeshModifier } from "../modifiers/ConstructSurfaceMeshModifier";
import { CoordinationPolyhedraModifier } from "../modifiers/CoordinationPolyhedraModifier";
import { DeleteSelectedModifier } from "../modifiers/DeleteSelectedModifier";
import { DisplacementVectorsModifier } from "../modifiers/DisplacementVectorsModifier";
import { EditTypesModifier } from "../modifiers/EditTypesModifier";
import { ExpandSelectionModifier } from "../modifiers/ExpandSelectionModifier";
import { ExpressionSelectionModifier } from "../modifiers/ExpressionSelectionModifier";
import { FreezePropertyModifier } from "../modifiers/FreezePropertyModifier";
import { HideHydrogensModifier } from "../modifiers/HideHydrogensModifier";
import { HideSelectionModifier } from "../modifiers/HideSelectionModifier";
import { InvertSelectionModifier } from "../modifiers/InvertSelectionModifier";
import { RadiusOfGyrationModifier } from "../modifiers/RadiusOfGyrationModifier";
import { ReplicateModifier } from "../modifiers/ReplicateModifier";
import { ClearSelectionModifier } from "../modifiers/SelectModifier";
import { SelectOverlappingModifier } from "../modifiers/SelectOverlappingModifier";
import { SelectTypeModifier } from "../modifiers/SelectTypeModifier";
import { SliceModifier } from "../modifiers/SliceModifier";
import { SmoothTrajectoryModifier } from "../modifiers/SmoothTrajectoryModifier";
import { SolidLiquidModifier } from "../modifiers/SolidLiquidModifier";
import { SteinhardtOrderModifier } from "../modifiers/SteinhardtOrderModifier";
import { TrajectoryLinesModifier } from "../modifiers/TrajectoryLinesModifier";
import { TransparentSelectionModifier } from "../modifiers/TransparentSelectionModifier";
import { UnwrapTrajectoriesModifier } from "../modifiers/UnwrapTrajectoriesModifier";
import { VectorFieldModifier } from "../modifiers/VectorFieldModifier";
import { WrapPBCModifier } from "../modifiers/WrapPBCModifier";
import { DrawAtomModifier } from "./draw_atom";
import { DrawBondModifier } from "./draw_bond";
import { DrawBoxModifier } from "./draw_box";
import { DrawIsosurfaceModifier } from "./draw_isosurface";
import { DrawRibbonModifier } from "./draw_ribbon";
import { GaussianDensitySurfaceModifier } from "./gaussian_density_surface";
import type { Modifier } from "./modifier";

// Type for a modifier factory function
export type ModifierFactory = () => Modifier;

/**
 * Add-menu groups — **same folders as OVITO** (minus Python).
 *
 * | Group | Who belongs |
 * |-------|-------------|
 * | Selection | produce / act on a selection set |
 * | Modification | topology / coordinate / filter / property edits |
 * | Coloring | per-atom color writers |
 * | Structure identification | local structure / order → columns (molrs) |
 * | Visualization | bonds, cell, surfaces, polyhedra, trajectory lines, … |
 * | Analysis | pipeline property compute that feeds viz (e.g. displacements) |
 *
 * Chart-only analyses (RDF, MSD, histograms, …) stay in the **left Analysis
 * panel**, not here — they do not change the scene by themselves.
 *
 * Auto-attach visual elements stay registered (`userAddable: false`) so load
 * paths and RPC still resolve them; they are omitted from the Add menu.
 */
export const MODIFIER_CATEGORIES = [
  "Selection",
  "Modification",
  "Coloring",
  "Structure identification",
  "Visualization",
  "Analysis",
] as const;

export type ModifierCategory = (typeof MODIFIER_CATEGORIES)[number];

export interface RegisterModifierOptions {
  /**
   * When false, kept for auto-attach / programmatic / RPC use but omitted
   * from the page Add-modifier menu. Default true.
   */
  userAddable?: boolean;
}

interface RegistryEntry {
  name: string;
  category: string;
  factory: ModifierFactory;
  /** Default true — see {@link RegisterModifierOptions.userAddable}. */
  userAddable: boolean;
}

/**
 * Module-level counter for deterministic modifier IDs.
 * Avoids non-deterministic Date.now() patterns.
 */
let _idCounter = 0;

/**
 * Generate a deterministic modifier ID with the given prefix.
 */
export function nextModifierId(prefix: string): string {
  return `${prefix}-${++_idCounter}`;
}

// biome-ignore lint/complexity/noStaticOnlyClass: ModifierRegistry is a singleton registry pattern used across the app
export class ModifierRegistry {
  private static entries: RegistryEntry[] = [];
  private static _defaultsRegistered = false;

  static register(
    name: string,
    category: string,
    factory: ModifierFactory,
    options?: RegisterModifierOptions,
  ) {
    const entry: RegistryEntry = {
      name,
      category,
      factory,
      userAddable: options?.userAddable ?? true,
    };
    // Replace existing entry with the same name so plugin reload is idempotent.
    const idx = ModifierRegistry.entries.findIndex((e) => e.name === name);
    if (idx >= 0) {
      ModifierRegistry.entries[idx] = entry;
      return;
    }
    ModifierRegistry.entries.push(entry);
  }

  /** Remove a previously registered modifier factory by display name. */
  static unregister(name: string): boolean {
    const before = ModifierRegistry.entries.length;
    ModifierRegistry.entries = ModifierRegistry.entries.filter(
      (e) => e.name !== name,
    );
    return ModifierRegistry.entries.length < before;
  }

  static getAvailableModifiers(): ReadonlyArray<RegistryEntry> {
    return ModifierRegistry.entries;
  }

  /** Entries shown in the page Add-modifier menu (excludes auto-attach-only). */
  static getUserAddableModifiers(): ReadonlyArray<RegistryEntry> {
    return ModifierRegistry.entries.filter((e) => e.userAddable);
  }

  static initialize() {
    if (ModifierRegistry._defaultsRegistered) return;
    ModifierRegistry._defaultsRegistered = true;
    // Note: DataSource subclasses (FileDataSource /
    // MemoryDataSource) are intentionally NOT registered here. They are
    // not user-addable from the modifier picker; they enter the
    // pipeline only via file ingress (`io/loadFileContent`,
    // `io/loadFileStream`) or RPC (`scene.add_data_source`).

    // ── Selection ───────────────────────────────────────────────────
    // Selection = "xx selection" style ops (produce or consume selection).
    // OVITO Selection group: Expression / Clear / Invert / Select Type /
    // Expand / Hide. Manual selection stays on Select mode → SelectModifier
    // (not Add-menu).
    ModifierRegistry.register(
      "Expression Select",
      "Selection",
      () => new ExpressionSelectionModifier(nextModifierId("expr-sel"), ""),
    );
    ModifierRegistry.register(
      ClearSelectionModifier.NAME,
      "Selection",
      () => new ClearSelectionModifier(nextModifierId("clear-sel")),
    );
    ModifierRegistry.register(
      InvertSelectionModifier.NAME,
      "Selection",
      () => new InvertSelectionModifier(nextModifierId("invert-sel")),
    );
    ModifierRegistry.register(
      SelectTypeModifier.NAME,
      "Selection",
      () => new SelectTypeModifier(nextModifierId("select-type")),
    );
    ModifierRegistry.register(
      ExpandSelectionModifier.NAME,
      "Selection",
      () => new ExpandSelectionModifier(nextModifierId("expand-sel")),
    );
    ModifierRegistry.register(
      SelectOverlappingModifier.NAME,
      "Selection",
      () => new SelectOverlappingModifier(nextModifierId("select-overlap")),
    );
    ModifierRegistry.register(
      "Hide Selection",
      "Selection",
      () => new HideSelectionModifier(),
    );

    // ── Modification ────────────────────────────────────────────────
    ModifierRegistry.register(
      "Slice",
      "Modification",
      () => new SliceModifier(),
    );
    ModifierRegistry.register(
      "Wrap PBC",
      "Modification",
      () => new WrapPBCModifier(nextModifierId("wrap-pbc")),
    );
    ModifierRegistry.register(
      AffineTransformationModifier.NAME,
      "Modification",
      () =>
        new AffineTransformationModifier(nextModifierId("affine-transform")),
    );
    ModifierRegistry.register(
      ReplicateModifier.NAME,
      "Modification",
      () => new ReplicateModifier(nextModifierId("replicate")),
    );
    ModifierRegistry.register(
      UnwrapTrajectoriesModifier.NAME,
      "Modification",
      () => new UnwrapTrajectoriesModifier(nextModifierId("unwrap-traj")),
    );
    ModifierRegistry.register(
      SmoothTrajectoryModifier.NAME,
      "Modification",
      () => new SmoothTrajectoryModifier(nextModifierId("smooth-traj")),
    );
    ModifierRegistry.register(
      ComputePropertyModifier.NAME,
      "Modification",
      () => new ComputePropertyModifier(nextModifierId("compute-prop")),
    );
    ModifierRegistry.register(
      FreezePropertyModifier.NAME,
      "Modification",
      () => new FreezePropertyModifier(nextModifierId("freeze-prop")),
    );
    ModifierRegistry.register(
      EditTypesModifier.NAME,
      "Modification",
      () => new EditTypesModifier(nextModifierId("edit-types")),
    );
    ModifierRegistry.register(
      "Delete Selected",
      "Modification",
      () => new DeleteSelectedModifier(),
    );
    ModifierRegistry.register(
      "Hide Hydrogens",
      "Modification",
      () => new HideHydrogensModifier(),
    );

    // ── Coloring ────────────────────────────────────────────────────
    ModifierRegistry.register(
      "Color by Property",
      "Coloring",
      () => new ColorByPropertyModifier(),
    );
    ModifierRegistry.register(
      ColorByTypeModifier.NAME,
      "Coloring",
      () => new ColorByTypeModifier(nextModifierId("color-by-type")),
    );
    ModifierRegistry.register(
      "Assign Color",
      "Coloring",
      () => new AssignColorModifier(),
    );

    // ── Structure identification (OVITO group; molrs backends only) ──
    // Chart-only bond-order θ/φ stays left Analysis, not here.
    ModifierRegistry.register(
      SteinhardtOrderModifier.NAME,
      "Structure identification",
      () => new SteinhardtOrderModifier(nextModifierId("steinhardt")),
    );
    ModifierRegistry.register(
      SolidLiquidModifier.NAME,
      "Structure identification",
      () => new SolidLiquidModifier(nextModifierId("solid-liquid")),
    );

    // ── Analysis (OVITO group — scene-feeding property compute) ─────
    // Pure charts (RDF/MSD/…) remain left Analysis panel only.
    ModifierRegistry.register(
      DisplacementVectorsModifier.NAME,
      "Analysis",
      () => new DisplacementVectorsModifier(nextModifierId("displacement")),
    );
    ModifierRegistry.register(
      ClusterModifier.NAME,
      "Analysis",
      // Slot is fixed at construction for menu adds; page reassigns free slot
      // via createClusterModifier / nextClusterSlot when needed.
      () => new ClusterModifier(nextModifierId("cluster"), 1),
    );
    ModifierRegistry.register(
      CenterOfMassModifier.NAME,
      "Analysis",
      () => new CenterOfMassModifier(nextModifierId("com")),
    );
    ModifierRegistry.register(
      RadiusOfGyrationModifier.NAME,
      "Analysis",
      () => new RadiusOfGyrationModifier(nextModifierId("rg")),
    );

    // ── Visualization (user-addable; OVITO names, not "Draw …") ─────
    ModifierRegistry.register(
      "Create bonds",
      "Visualization",
      () => new ComputeBondsModifier(nextModifierId("compute-bonds")),
    );
    ModifierRegistry.register(
      DrawBondModifier.NAME, // "Bonds"
      "Visualization",
      () => new DrawBondModifier(),
    );
    ModifierRegistry.register(
      DrawBoxModifier.NAME, // "Simulation cell"
      "Visualization",
      () => new DrawBoxModifier(),
    );
    ModifierRegistry.register(
      VectorFieldModifier.NAME,
      "Visualization",
      () => new VectorFieldModifier(nextModifierId("vector-field")),
    );
    ModifierRegistry.register(
      GaussianDensitySurfaceModifier.NAME,
      "Visualization",
      () =>
        new GaussianDensitySurfaceModifier(
          nextModifierId("gaussian-density-surface"),
        ),
    );
    ModifierRegistry.register(
      ConstructSurfaceMeshModifier.DISPLAY_NAME,
      "Visualization",
      () =>
        new ConstructSurfaceMeshModifier(nextModifierId("construct-surface")),
    );
    ModifierRegistry.register(
      CoordinationPolyhedraModifier.NAME,
      "Visualization",
      () =>
        new CoordinationPolyhedraModifier(nextModifierId("coord-polyhedra")),
    );
    ModifierRegistry.register(
      TrajectoryLinesModifier.NAME,
      "Visualization",
      () => new TrajectoryLinesModifier(nextModifierId("traj-lines")),
    );
    ModifierRegistry.register(
      CameraTrackModifier.NAME,
      "Visualization",
      () => new CameraTrackModifier(nextModifierId("camera-track")),
    );

    // ── Auto-attach only (visual elements; not in Add menu) ─────────
    ModifierRegistry.register(
      DrawAtomModifier.NAME, // "Particles"
      "Visualization",
      () => new DrawAtomModifier(),
      { userAddable: false },
    );
    ModifierRegistry.register(
      DrawRibbonModifier.NAME, // "Ribbon"
      "Visualization",
      () => new DrawRibbonModifier(),
      { userAddable: false },
    );
    // Grid → marching-cubes surface. Auto-attaches when a grid block is
    // present; also user-addable so empty pipelines can stage the step.
    ModifierRegistry.register(
      DrawIsosurfaceModifier.NAME, // "Create isosurface"
      "Visualization",
      () => new DrawIsosurfaceModifier(),
    );
    // Transparency is particle display property, not an Add-menu item.
    ModifierRegistry.register(
      "Transparent",
      "Coloring",
      () => new TransparentSelectionModifier(),
      { userAddable: false },
    );
  }
}

export function registerDefaultModifiers(): void {
  ModifierRegistry.initialize();
}
