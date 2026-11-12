import type { ClusterModifier as Core, Molvis } from "@molcrafts/molvis-stage";
import { Input, Label, Switch, ToggleAction } from "@molcrafts/ui";
import type React from "react";
import { useEffect, useState } from "react";
import { useApplyPipelineOperation } from "@/hooks/useApplyPipelineOperation";
import type { ModifierPanelSurface } from "@/plugins/types";
import { ScalarSliderRow } from "./ScalarSliderRow";

interface Props {
  modifier: Core;
  app: Molvis | null;
  onUpdate: () => void;
  surface?: ModifierPanelSurface;
}

export const ClusterModifier: React.FC<Props> = ({
  modifier,
  app,
  onUpdate,
  surface = "full",
}) => {
  const { applyPipeline, pipelineRunning } = useApplyPipelineOperation(
    app,
    onUpdate,
    {
      running: "Computing clusters…",
      success: "Clusters updated",
      error: "Could not compute clusters",
    },
  );
  const showCompute = surface === "full" || surface === "compute";
  const showDraw = surface === "full" || surface === "draw";

  // String draft so the user can clear the field while typing (type=number
  // controlled with value={1} refuses to delete the last digit).
  const [maskIdText, setMaskIdText] = useState(String(modifier.slot));
  useEffect(() => {
    setMaskIdText(String(modifier.slot));
  }, [modifier.slot]);

  const commitMaskId = () => {
    const n = Number.parseInt(maskIdText, 10);
    if (Number.isFinite(n) && n >= 1) {
      modifier.setSlot(n);
    } else {
      setMaskIdText(String(modifier.slot));
    }
    onUpdate();
    void applyPipeline();
  };

  return (
    <fieldset
      disabled={!app || pipelineRunning}
      className="m-0 space-y-3 border-0 p-0"
    >
      {showCompute && (
        <>
          <div className="space-y-1.5">
            <Label className="text-micro" htmlFor="cluster-mask-id">
              Mask id
            </Label>
            <Input
              id="cluster-mask-id"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              className="h-control-compact font-mono text-label"
              value={maskIdText}
              onChange={(e) => setMaskIdText(e.target.value)}
              onBlur={commitMaskId}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.currentTarget.blur();
                }
              }}
              aria-label="Mask id"
            />
            <p className="font-mono text-micro text-muted-foreground">
              {modifier.columnName}
            </p>
          </div>

          <div className="space-y-1.5">
            <Label className="text-micro">Connectivity</Label>
            <div className="grid grid-cols-2 gap-1">
              <ToggleAction
                selected={modifier.mode === "cutoff"}
                onClick={() => {
                  modifier.setMode("cutoff");
                  void applyPipeline();
                }}
              >
                Cutoff
              </ToggleAction>
              <ToggleAction
                selected={modifier.mode === "bonds"}
                onClick={() => {
                  modifier.setMode("bonds");
                  void applyPipeline();
                }}
              >
                Bonds
              </ToggleAction>
            </div>
          </div>

          {modifier.mode === "cutoff" && (
            <ScalarSliderRow
              label="Cutoff (Å)"
              value={modifier.rMax}
              min={0.4}
              max={12}
              step={0.1}
              onPreview={(v) => {
                modifier.setRMax(v);
                onUpdate();
              }}
              onCommit={() => void applyPipeline({ fullRebuild: true })}
            />
          )}
        </>
      )}
      {showDraw && (
        <div className="flex items-center justify-between gap-2">
          <Label className="text-micro">Color by cluster</Label>
          <Switch
            checked={modifier.colorScene}
            onCheckedChange={(on) => {
              modifier.setColorScene(on);
              void applyPipeline({ fullRebuild: true });
            }}
          />
        </div>
      )}
    </fieldset>
  );
};
