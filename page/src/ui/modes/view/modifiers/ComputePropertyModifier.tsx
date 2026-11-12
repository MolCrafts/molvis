import type {
  ComputePropertyModifier as Core,
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

export const ComputePropertyModifier: React.FC<Props> = ({
  modifier,
  app,
  onUpdate,
}) => {
  const { applyPipeline, pipelineRunning } = useApplyPipelineOperation(
    app,
    onUpdate,
    {
      running: "Computing property…",
      success: "Property computed",
      error: "Could not compute property",
    },
  );
  return (
    <fieldset
      disabled={!app || pipelineRunning}
      className="m-0 space-y-3 border-0 p-0"
    >
      <div className="space-y-1.5">
        <Label className="text-micro">Expression</Label>
        <Input
          className="h-control-compact font-mono text-label"
          defaultValue={modifier.expression}
          onBlur={(e) => {
            modifier.setExpression(e.target.value);
            void applyPipeline();
          }}
        />
      </div>
      <div className="space-y-1.5">
        <Label className="text-micro">Output column</Label>
        <Input
          className="h-control-compact text-label"
          defaultValue={modifier.outputColumn}
          onBlur={(e) => {
            modifier.setOutputColumn(e.target.value);
            void applyPipeline();
          }}
        />
      </div>
    </fieldset>
  );
};
