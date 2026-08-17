import type {
  ReplicateModifier as CoreReplicate,
  Molvis,
} from "@molcrafts/molvis-stage";
import type React from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useApplyPipelineOperation } from "@/hooks/useApplyPipelineOperation";

interface Props {
  modifier: CoreReplicate;
  app: Molvis | null;
  onUpdate: () => void;
}

const PIPELINE_COPY = {
  running: "Replicating periodic images…",
  success: "Replicate updated",
  error: "Could not replicate",
};

export const ReplicateModifier: React.FC<Props> = ({
  modifier,
  app,
  onUpdate,
}) => {
  const { applyPipeline, pipelineRunning } = useApplyPipelineOperation(
    app,
    onUpdate,
    PIPELINE_COPY,
  );

  const setAxis = (axis: "nx" | "ny" | "nz", raw: string) => {
    const n = Number.parseInt(raw, 10);
    if (!Number.isFinite(n)) return;
    const nx = axis === "nx" ? n : modifier.nx;
    const ny = axis === "ny" ? n : modifier.ny;
    const nz = axis === "nz" ? n : modifier.nz;
    modifier.setCounts(nx, ny, nz);
    onUpdate();
  };

  return (
    <fieldset
      disabled={!app || pipelineRunning}
      aria-busy={pipelineRunning}
      className="m-0 space-y-3 border-0 p-0"
    >
      <div className="grid grid-cols-3 gap-1.5">
        {(
          [
            ["nx", modifier.nx],
            ["ny", modifier.ny],
            ["nz", modifier.nz],
          ] as const
        ).map(([key, value]) => (
          <div key={key} className="space-y-1">
            <Label className="text-micro">{key}</Label>
            <Input
              type="number"
              min={1}
              max={20}
              step={1}
              className="h-8 text-xs"
              value={value}
              onChange={(e) => setAxis(key, e.target.value)}
              onBlur={() => void applyPipeline()}
            />
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between gap-2">
        <Label className="text-micro">Adjust simulation cell</Label>
        <Switch
          checked={modifier.adjustBox}
          onCheckedChange={(on) => {
            modifier.setAdjustBox(on);
            void applyPipeline();
          }}
        />
      </div>
    </fieldset>
  );
};
