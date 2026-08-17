import {
  type BondCriterion,
  ComputeBondsModifier as CoreComputeBondsModifier,
  type ComputeBondsModifier as CoreModifier,
  type Molvis,
} from "@molcrafts/molvis-stage";
import type React from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { useApplyPipelineOperation } from "@/hooks/useApplyPipelineOperation";

interface Props {
  modifier: CoreModifier;
  app: Molvis | null;
  onUpdate: () => void;
}

const PIPELINE_COPY = {
  running: "Recomputing bonds…",
  success: "Bonds recomputed",
  error: "Could not recompute bonds",
};

export const ComputeBondsModifier: React.FC<Props> = ({
  modifier,
  app,
  onUpdate,
}) => {
  const { applyPipeline, pipelineRunning } = useApplyPipelineOperation(
    app,
    onUpdate,
    PIPELINE_COPY,
  );

  const triggerUpdate = () => {
    applyPipeline({ fullRebuild: true });
  };

  const updateNumber = (
    key: "cutoff" | "tolerance" | "minDistance",
    value: string,
  ) => {
    const numeric = Number(value);
    if (Number.isNaN(numeric)) {
      throw new Error(`Create bonds: ${key} must be a number`);
    }
    modifier[key] = numeric;
    triggerUpdate();
  };

  const isCovalent = modifier.criterion === "covalent";

  // Covalent mode needs per-atom element symbols. Disable it (with an
  // explanatory tooltip) when the loaded frame carries only numeric types.
  const frame = app?.system?.frame ?? null;
  const hasElementData = frame
    ? CoreComputeBondsModifier.hasElementData(frame)
    : true;
  const covalentDisabledReason = "No element column — use Fixed distance";

  return (
    <fieldset
      disabled={!app || pipelineRunning}
      aria-busy={pipelineRunning}
      className="m-0 min-w-0 space-y-4 border-0 p-0 text-xs"
    >
      <div className="space-y-1">
        <Label className="text-xs font-semibold">Criterion</Label>
        <Select
          value={modifier.criterion}
          onValueChange={(v) => {
            modifier.criterion = v as BondCriterion;
            triggerUpdate();
          }}
        >
          <SelectTrigger
            aria-label="Bond criterion"
            className="h-control-compact text-xs"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="covalent" disabled={!hasElementData}>
              <span title={hasElementData ? undefined : covalentDisabledReason}>
                Covalent radii
              </span>
            </SelectItem>
            <SelectItem value="distance">Fixed distance</SelectItem>
          </SelectContent>
        </Select>
        {isCovalent && !hasElementData && (
          <p className="text-micro text-status-failed-foreground">
            No element column — switch to Fixed distance
          </p>
        )}
      </div>

      <Separator />

      {isCovalent ? (
        <div className="space-y-1">
          <div className="flex justify-between">
            <Label className="text-xs font-semibold">Tolerance</Label>
            <span className="text-micro text-muted-foreground font-mono">
              {modifier.tolerance.toFixed(2)}
            </span>
          </div>
          <div className="flex gap-2 items-center">
            <Input
              aria-label="Covalent tolerance"
              type="range"
              min={0.8}
              max={1.6}
              step={0.01}
              value={modifier.tolerance}
              onChange={(e) => updateNumber("tolerance", e.target.value)}
              className="h-6"
            />
            <Input
              aria-label="Covalent tolerance value"
              type="number"
              step="0.05"
              value={modifier.tolerance}
              onChange={(e) => updateNumber("tolerance", e.target.value)}
              className="w-16 h-control-compact px-2 text-xs"
            />
          </div>
        </div>
      ) : (
        <div className="space-y-1">
          <Label className="text-xs font-semibold">Cutoff (Å)</Label>
          <Input
            aria-label="Bond cutoff in angstroms"
            type="number"
            min="0.1"
            step="0.1"
            value={modifier.cutoff}
            onChange={(e) => updateNumber("cutoff", e.target.value)}
            className="h-control-compact px-2 text-xs"
          />
        </div>
      )}

      <Separator />

      <div className="space-y-1">
        <Label className="text-micro text-muted-foreground">
          Min distance (Å)
        </Label>
        <Input
          aria-label="Minimum bond distance in angstroms"
          type="number"
          min="0"
          step="0.1"
          value={modifier.minDistance}
          onChange={(e) => updateNumber("minDistance", e.target.value)}
          className="h-control-compact px-2 text-xs"
        />
      </div>
    </fieldset>
  );
};
