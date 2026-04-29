import { AssignColorModifier } from "../modifiers/AssignColorModifier";
import { ColorByPropertyModifier } from "../modifiers/ColorByPropertyModifier";
import { DeleteSelectedModifier } from "../modifiers/DeleteSelectedModifier";
import { ExpressionSelectionModifier } from "../modifiers/ExpressionSelectionModifier";
import { HideHydrogensModifier } from "../modifiers/HideHydrogensModifier";
import { HideSelectionModifier } from "../modifiers/HideSelectionModifier";
import { SliceModifier } from "../modifiers/SliceModifier";
import { TransparentSelectionModifier } from "../modifiers/TransparentSelectionModifier";
import { WrapPBCModifier } from "../modifiers/WrapPBCModifier";
import { DrawAtomModifier } from "./draw_atom";
import { DrawBondModifier } from "./draw_bond";
import { DrawBoxModifier } from "./draw_box";
import { DrawIsosurfaceModifier } from "./draw_isosurface";
import { DrawRibbonModifier } from "./draw_ribbon";
import type { Modifier } from "./modifier";

// Type for a modifier factory function
export type ModifierFactory = () => Modifier;

interface RegistryEntry {
  name: string;
  category: string;
  factory: ModifierFactory;
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

  static register(name: string, category: string, factory: ModifierFactory) {
    ModifierRegistry.entries.push({ name, category, factory });
  }

  static getAvailableModifiers(): ReadonlyArray<RegistryEntry> {
    return ModifierRegistry.entries;
  }

  static initialize() {
    if (ModifierRegistry._defaultsRegistered) return;
    ModifierRegistry._defaultsRegistered = true;
    // Note: DataSourceModifier subclasses (TrajectoryDataSource /
    // FrameDataSource) are intentionally NOT registered here. They are
    // not user-addable from the modifier picker; they enter the
    // pipeline only via file ingress (`io/loadFileContent`,
    // `io/loadFileStream`) or RPC (`scene.add_data_source`).
    ModifierRegistry.register(
      "Slice",
      "Selection Insensitive",
      () => new SliceModifier(),
    );
    ModifierRegistry.register(
      "Wrap PBC",
      "Selection Insensitive",
      () => new WrapPBCModifier(nextModifierId("wrap-pbc")),
    );
    ModifierRegistry.register(
      "Expression Select",
      "Selection Sensitive",
      () => new ExpressionSelectionModifier(nextModifierId("expr-sel"), ""),
    );
    ModifierRegistry.register(
      "Hide Selection",
      "Selection Sensitive",
      () => new HideSelectionModifier(),
    );
    ModifierRegistry.register(
      "Color by Property",
      "Selection Insensitive",
      () => new ColorByPropertyModifier(),
    );
    ModifierRegistry.register(
      "Hide Hydrogens",
      "Selection Insensitive",
      () => new HideHydrogensModifier(),
    );
    ModifierRegistry.register(
      "Assign Color",
      "Selection Sensitive",
      () => new AssignColorModifier(),
    );
    ModifierRegistry.register(
      "Transparent",
      "Selection Sensitive",
      () => new TransparentSelectionModifier(),
    );
    ModifierRegistry.register(
      "Delete Selected",
      "Selection Sensitive",
      () => new DeleteSelectedModifier(),
    );
    ModifierRegistry.register(
      DrawAtomModifier.NAME,
      "Draw",
      () => new DrawAtomModifier(),
    );
    ModifierRegistry.register(
      DrawBondModifier.NAME,
      "Draw",
      () => new DrawBondModifier(),
    );
    ModifierRegistry.register(
      DrawBoxModifier.NAME,
      "Draw",
      () => new DrawBoxModifier(),
    );
    ModifierRegistry.register(
      DrawRibbonModifier.NAME,
      "Draw",
      () => new DrawRibbonModifier(),
    );
    ModifierRegistry.register(
      DrawIsosurfaceModifier.NAME,
      "Draw",
      () => new DrawIsosurfaceModifier(),
    );
  }
}

export function registerDefaultModifiers(): void {
  ModifierRegistry.initialize();
}
