import type {
  EditTypesModifier as Core,
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

export const EditTypesModifier: React.FC<Props> = ({
  modifier,
  app,
  onUpdate,
}) => {
  const { applyPipeline, pipelineRunning } = useApplyPipelineOperation(
    app,
    onUpdate,
    {
      running: "Editing types…",
      success: "Types updated",
      error: "Could not edit types",
    },
  );
  return (
    <fieldset
      disabled={!app || pipelineRunning}
      className="m-0 space-y-3 border-0 p-0"
    >
      <div className="space-y-1.5">
        <Label className="text-micro">Element</Label>
        <Input
          className="h-control-compact text-label"
          defaultValue={modifier.element ?? ""}
          placeholder="C"
          onBlur={(e) => {
            modifier.setElement(e.target.value || null);
            void applyPipeline();
          }}
        />
      </div>
      <div className="space-y-1.5">
        <Label className="text-micro">Type</Label>
        <Input
          className="h-control-compact text-label"
          defaultValue={modifier.typeValue ?? ""}
          placeholder="optional"
          onBlur={(e) => {
            modifier.setTypeValue(e.target.value || null);
            void applyPipeline();
          }}
        />
      </div>
    </fieldset>
  );
};
