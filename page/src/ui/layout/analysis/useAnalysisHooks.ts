import type { Molvis } from "@molcrafts/molvis-stage";
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
