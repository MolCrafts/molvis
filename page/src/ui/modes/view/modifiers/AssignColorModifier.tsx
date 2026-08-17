import type {
  AssignColorModifier as CoreAssignColorModifier,
  Molvis,
} from "@molcrafts/molvis-stage";
import type React from "react";
import { Label } from "@/components/ui/label";
import { useApplyPipelineOperation } from "@/hooks/useApplyPipelineOperation";

interface ModifierProps {
  modifier: CoreAssignColorModifier;
  app: Molvis | null;
  onUpdate: () => void;
}

const PIPELINE_COPY = {
  running: "Updating atom colors…",
  success: "Atom colors updated",
  error: "Could not update atom colors",
};

export const AssignColorModifier: React.FC<ModifierProps> = ({
  modifier,
  app,
  onUpdate,
}) => {
  const { applyPipeline, pipelineRunning } = useApplyPipelineOperation(
    app,
    onUpdate,
    PIPELINE_COPY,
  );

  const handleColorChange = (color: string) => {
    modifier.setPrimaryColor(color);
    applyPipeline({ fullRebuild: true });
  };

  return (
    <fieldset
      disabled={!app || pipelineRunning}
      aria-busy={pipelineRunning}
      className="m-0 min-w-0 space-y-4 border-0 p-0"
    >
      <div className="flex items-center justify-between text-xs">
        <Label>Affected Atoms</Label>
        <span className="font-mono text-muted-foreground">
          {modifier.selectedCount}
        </span>
      </div>

      <div className="grid gap-2">
        <Label htmlFor={`${modifier.id}-assign-color`}>Color</Label>
        <div className="flex items-center gap-2">
          <input
            id={`${modifier.id}-assign-color`}
            type="color"
            value={modifier.primaryColor}
            onChange={(event) => handleColorChange(event.target.value)}
            className="h-9 w-12 cursor-pointer rounded-control border bg-transparent p-1"
          />
          <div className="font-mono text-xs text-muted-foreground">
            {modifier.primaryColor.toUpperCase()}
          </div>
        </div>
      </div>
    </fieldset>
  );
};
