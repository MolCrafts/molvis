import type {
  UnwrapTrajectoriesModifier as CoreUnwrap,
  Molvis,
} from "@molcrafts/molvis-stage";
import type React from "react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useApplyPipelineOperation } from "@/hooks/useApplyPipelineOperation";

interface Props {
  modifier: CoreUnwrap;
  app: Molvis | null;
  onUpdate: () => void;
}

const PIPELINE_COPY = {
  running: "Unwrapping trajectory…",
  success: "Unwrap updated",
  error: "Could not unwrap",
};

export const UnwrapTrajectoriesModifier: React.FC<Props> = ({
  modifier,
  app,
  onUpdate,
}) => {
  const { applyPipeline, pipelineRunning } = useApplyPipelineOperation(
    app,
    onUpdate,
    PIPELINE_COPY,
  );

  return (
    <fieldset
      disabled={!app || pipelineRunning}
      aria-busy={pipelineRunning}
      className="m-0 space-y-3 border-0 p-0"
    >
      <div className="flex items-center justify-between gap-2">
        <Label className="text-micro">Molecule-aware (reserved)</Label>
        <Switch
          checked={modifier.moleculeAware}
          onCheckedChange={(on) => {
            modifier.setMoleculeAware(on);
            modifier.resetState();
            void applyPipeline();
          }}
        />
      </div>
    </fieldset>
  );
};
