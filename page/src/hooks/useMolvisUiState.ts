import type { DatasetExploration, Molvis } from "@molcrafts/molvis-stage";
import type { Dispatch, SetStateAction } from "react";
import { useEffect, useState } from "react";

/**
 * Tracks UI-facing runtime state mirrored from Molvis event streams.
 */
export function useMolvisUiState(app: Molvis | null): {
  currentMode: string;
  setCurrentMode: Dispatch<SetStateAction<string>>;
  trajectoryLength: number;
  frameLabels: Map<string, Float64Array> | null;
  exploration: DatasetExploration | null;
} {
  const [currentMode, setCurrentMode] = useState<string>("view");
  const [trajectoryLength, setTrajectoryLength] = useState<number>(1);
  const [frameLabels, setFrameLabels] = useState<Map<
    string,
    Float64Array
  > | null>(null);
  const [exploration, setExploration] = useState<DatasetExploration | null>(
    null,
  );

  useEffect(() => {
    if (!app) {
      return;
    }

    if (app.mode) {
      setCurrentMode(app.mode.name);
    }
    setTrajectoryLength(app.system.trajectory.length);
    setFrameLabels(app.system.frameLabels);
    setExploration(app.system.exploration);

    const handleModeChange = (mode: string) => {
      setCurrentMode(mode);
    };

    const handleTrajectoryChange = (
      trajectory: Molvis["system"]["trajectory"],
    ) => {
      setTrajectoryLength(trajectory.length);
    };

    const handleFrameLabelsChange = (
      labels: Map<string, Float64Array> | null,
    ) => {
      setFrameLabels(labels);
    };

    const handleExplorationChange = (next: DatasetExploration | null) => {
      setExploration(next);
    };

    app.events.on("mode-change", handleModeChange);
    app.events.on("trajectory-change", handleTrajectoryChange);
    app.events.on("frame-labels-change", handleFrameLabelsChange);
    app.events.on("exploration-change", handleExplorationChange);

    return () => {
      app.events.off("mode-change", handleModeChange);
      app.events.off("trajectory-change", handleTrajectoryChange);
      app.events.off("frame-labels-change", handleFrameLabelsChange);
      app.events.off("exploration-change", handleExplorationChange);
    };
  }, [app]);

  return {
    currentMode,
    setCurrentMode,
    trajectoryLength,
    frameLabels,
    exploration,
  };
}
