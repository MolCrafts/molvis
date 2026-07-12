import type { Molvis } from "@molvis/core";
import { useEffect, useState } from "react";

export function useTrajectoryLength(app: Molvis | null): number {
  const [length, setLength] = useState(
    () => app?.system.trajectory.length ?? 0,
  );
  useEffect(() => {
    if (!app) {
      setLength(0);
      return;
    }
    setLength(app.system.trajectory.length);
    return app.events.on("trajectory-change", (trajectory) => {
      setLength(trajectory.length);
    });
  }, [app]);
  return length;
}

/** Row indices of the atoms currently selected in the scene. */
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
