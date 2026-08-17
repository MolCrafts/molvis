import type {
  SelectModifier as CoreSelectModifier,
  Molvis,
} from "@molcrafts/molvis-stage";
import type React from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { useApplyPipelineOperation } from "@/hooks/useApplyPipelineOperation";

interface ModifierProps {
  modifier: CoreSelectModifier;
  app: Molvis | null;
  onUpdate: () => void;
}

const PIPELINE_COPY = {
  running: "Updating selection highlighting…",
  success: "Selection highlighting updated",
  error: "Could not update selection highlighting",
};

export const SelectModifierProps: React.FC<ModifierProps> = ({
  modifier,
  app,
  onUpdate,
}) => {
  const { applyPipeline, pipelineRunning } = useApplyPipelineOperation(
    app,
    onUpdate,
    PIPELINE_COPY,
  );

  const handleToggleHighlight = (checked: boolean) => {
    modifier.highlight = checked;
    applyPipeline({ fullRebuild: true });
  };

  return (
    <fieldset
      disabled={!app || pipelineRunning}
      aria-busy={pipelineRunning}
      className="m-0 min-w-0 space-y-4 border-0 p-0"
    >
      <div className="flex items-center justify-between text-xs">
        <Label>ID</Label>
        <span className="font-mono text-muted-foreground">{modifier.id}</span>
      </div>

      <div className="flex items-center justify-between text-xs">
        <Label>Selection</Label>
        <span className="font-mono text-muted-foreground">
          {modifier.selectionSummary}
        </span>
      </div>

      <div className="flex items-center justify-between text-xs">
        <Label>Mode</Label>
        <span className="font-mono text-muted-foreground">{modifier.mode}</span>
      </div>

      <div className="flex items-center justify-between">
        <Label className="text-xs">Show Highlight</Label>
        <Checkbox
          aria-label="Show selection highlight"
          checked={modifier.highlight}
          onCheckedChange={(checked) => handleToggleHighlight(checked === true)}
        />
      </div>
    </fieldset>
  );
};
