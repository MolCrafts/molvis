import type {
  EditTypesModifier as Core,
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
          className="h-8 text-xs"
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
          className="h-8 text-xs"
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
