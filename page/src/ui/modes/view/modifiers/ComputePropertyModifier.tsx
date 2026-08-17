import type {
  ComputePropertyModifier as Core,
  Molvis,
} from "@molcrafts/molvis-stage";
import type React from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
          className="h-8 font-mono text-xs"
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
          className="h-8 text-xs"
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
