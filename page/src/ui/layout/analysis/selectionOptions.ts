import type { AnalysisAtomSelection, Molvis } from "@molvis/core";

export interface ModifierOption {
  id: string;
  label: string;
  count: number;
}

export const ALL_ATOMS_OPTION_ID = "__all_atoms";
export const CURRENT_SELECTION_OPTION_ID = "__current_selection";

export type SelectionOptionMap = Map<string, AnalysisAtomSelection>;

/** Build atom-group options: all atoms, current selection, pipeline masks. */
export function collectAtomSelectionOptions(app: Molvis): {
  options: ModifierOption[];
  selections: SelectionOptionMap;
} {
  const frame = app.system.frame;
  const atoms = frame?.getBlock("atoms");
  const atomCount = atoms?.nrows() ?? 0;
  const options: ModifierOption[] = [
    { id: ALL_ATOMS_OPTION_ID, label: "All atoms", count: atomCount },
  ];
  const selections: SelectionOptionMap = new Map([
    [ALL_ATOMS_OPTION_ID, { kind: "all" }],
  ]);

  const manual = Array.from(app.world.selectionManager.getState().atoms).filter(
    (idx) => idx >= 0 && idx < atomCount,
  );
  if (manual.length > 0) {
    options.push({
      id: CURRENT_SELECTION_OPTION_ID,
      label: "Current selection",
      count: manual.length,
    });
    selections.set(CURRENT_SELECTION_OPTION_ID, {
      kind: "indices",
      indices: manual,
    });
  }

  const selSet = app.selectionSet;
  const pipelineMods = app.modifierPipeline.getModifiers();
  for (const mod of pipelineMods) {
    const mask = selSet.get(mod.id);
    if (mask) {
      options.push({ id: mod.id, label: mod.name, count: mask.count() });
      selections.set(mod.id, { kind: "mask", mask });
    }
  }

  return { options, selections };
}
