import type {
  FreezePropertyModifier as Core,
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

export const FreezePropertyModifier: React.FC<Props> = ({
  modifier,
  app,
  onUpdate,
}) => {
  const { applyPipeline, pipelineRunning } = useApplyPipelineOperation(
    app,
    onUpdate,
    {
      running: "Freezing property…",
      success: "Property frozen",
      error: "Could not freeze property",
    },
  );
  return (
    <fieldset
      disabled={!app || pipelineRunning}
      className="m-0 space-y-3 border-0 p-0"
    >
      <div className="space-y-1.5">
        <Label className="text-micro">Column</Label>
        <Input
          className="h-control-compact text-label"
          defaultValue={modifier.column}
          placeholder="e.g. x or Compute"
          onBlur={(e) => {
            modifier.setColumn(e.target.value);
            modifier.clearFreeze();
            void applyPipeline();
          }}
        />
      </div>
    </fieldset>
  );
};
