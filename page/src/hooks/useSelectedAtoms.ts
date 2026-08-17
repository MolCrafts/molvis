import type { Molvis } from "@molcrafts/molvis-stage";
import { useEffect, useState } from "react";

/** Row indices of the atoms currently selected in the molecular scene. */
export function useSelectedAtoms(app: Molvis | null): number[] {
  const [selected, setSelected] = useState<number[]>([]);

  useEffect(() => {
    if (!app) {
      setSelected([]);
      return;
    }

    const manager = app.world.selectionManager;
    const sync = () => setSelected(Array.from(manager.getState().atoms));
    sync();
    manager.on("selection-change", sync);
    return () => {
      manager.off("selection-change", sync);
    };
  }, [app]);

  return selected;
}
