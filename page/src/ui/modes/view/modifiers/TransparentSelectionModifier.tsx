import type {
  TransparentSelectionModifier as CoreTransparentSelectionModifier,
  Molvis,
} from "@molcrafts/molvis-stage";
import type React from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useApplyPipelineOperation } from "@/hooks/useApplyPipelineOperation";

interface ModifierProps {
  modifier: CoreTransparentSelectionModifier;
  app: Molvis | null;
  onUpdate: () => void;
}

const PIPELINE_COPY = {
  running: "Updating selection transparency…",
  success: "Selection transparency updated",
  error: "Could not update selection transparency",
};

export const TransparentSelectionModifier: React.FC<ModifierProps> = ({
  modifier,
  app,
  onUpdate,
}) => {
  const { applyPipeline, pipelineRunning } = useApplyPipelineOperation(
    app,
    onUpdate,
    PIPELINE_COPY,
  );

  const apply = (value: string) => {
    const num = Number(value);
    if (!Number.isFinite(num)) return;
    modifier.opacity = Math.max(0.02, Math.min(1.0, num));
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

      <div className="space-y-2">
        <Label className="text-xs">Transparency</Label>
        <Input
          aria-label="Selection transparency"
          type="number"
          min={0}
          max={0.98}
          step={0.05}
          defaultValue={1 - modifier.opacity}
          onBlur={(e) => {
            const t = Number(e.target.value);
            if (!Number.isFinite(t)) return;
            apply(String(1 - t));
          }}
          className="h-control-compact px-2 text-xs"
        />
      </div>
    </fieldset>
  );
};
