import type {
  SmoothTrajectoryModifier as Core,
  Molvis,
} from "@molcrafts/molvis-stage";
import { Input, Label } from "@molcrafts/ui";
import type React from "react";
import { useApplyPipelineOperation } from "@/hooks/useApplyPipelineOperation";

interface Props {
  modifier: Core;
  app: Molvis | null;
  onUpdate: () => void;
}

export const SmoothTrajectoryModifier: React.FC<Props> = ({
  modifier,
  app,
  onUpdate,
}) => {
  const { applyPipeline, pipelineRunning } = useApplyPipelineOperation(
    app,
    onUpdate,
    {
      running: "Smoothing trajectory…",
      success: "Trajectory smoothed",
      error: "Could not smooth trajectory",
    },
  );
  return (
    <fieldset
      disabled={!app || pipelineRunning}
      className="m-0 space-y-3 border-0 p-0"
    >
      <div className="space-y-1.5">
        <Label className="text-micro">Window half-width</Label>
        <Input
          type="number"
          min={0}
          max={50}
          step={1}
          className="h-control-compact text-label"
          value={modifier.windowHalf}
          onChange={(e) => {
            modifier.setWindowHalf(Number(e.target.value));
            onUpdate();
          }}
          onBlur={() => void applyPipeline()}
        />
      </div>
    </fieldset>
  );
};
