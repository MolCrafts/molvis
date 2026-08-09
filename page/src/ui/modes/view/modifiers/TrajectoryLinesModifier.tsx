import type {
  TrajectoryLinesModifier as Core,
  Molvis,
} from "@molcrafts/molvis-stage";
import type React from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useApplyPipelineOperation } from "@/hooks/useApplyPipelineOperation";
import type { ModifierPanelSurface } from "@/plugins/types";
import { ScalarSliderRow } from "./ScalarSliderRow";

interface Props {
  modifier: Core;
  app: Molvis | null;
  onUpdate: () => void;
  surface?: ModifierPanelSurface;
}

export const TrajectoryLinesModifier: React.FC<Props> = ({
  modifier,
  app,
  onUpdate,
  surface = "full",
}) => {
  const { applyPipeline, pipelineRunning } = useApplyPipelineOperation(
    app,
    onUpdate,
    {
      running: "Building trajectory lines…",
      success: "Trajectory lines updated",
      error: "Could not build trajectory lines",
    },
  );
  const showCompute = surface === "full" || surface === "compute";
  const showDraw = surface === "full" || surface === "draw";

  return (
    <fieldset
      disabled={!app || pipelineRunning}
      className="m-0 space-y-3 border-0 p-0"
    >
      {showCompute && (
        <>
          <div className="flex items-center justify-between gap-2">
            <Label className="text-micro">Prefer selection</Label>
            <Switch
              checked={modifier.onlySelection}
              onCheckedChange={(on) => {
                modifier.setOnlySelection(on);
                void applyPipeline();
              }}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-micro">Max atoms</Label>
            <Input
              type="number"
              min={1}
              max={5000}
              className="h-8 text-xs"
              value={modifier.maxAtoms}
              onChange={(e) => {
                modifier.setMaxAtoms(Number(e.target.value));
                onUpdate();
              }}
              onBlur={() => void applyPipeline()}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-micro">Frame stride</Label>
            <Input
              type="number"
              min={1}
              max={100}
              className="h-8 text-xs"
              value={modifier.frameStride}
              onChange={(e) => {
                modifier.setFrameStride(Number(e.target.value));
                onUpdate();
              }}
              onBlur={() => void applyPipeline()}
            />
          </div>
        </>
      )}
      {showDraw && (
        <>
          <div className="space-y-1.5">
            <Label className="text-micro">Color</Label>
            <Input
              type="color"
              className="h-8 w-full p-1"
              value={modifier.color}
              onChange={(e) => {
                modifier.setColor(e.target.value);
                void applyPipeline();
              }}
            />
          </div>
          <ScalarSliderRow
            label="Opacity"
            value={modifier.opacity}
            min={0}
            max={1}
            step={0.05}
            onPreview={(o) => {
              modifier.setOpacity(o);
              onUpdate();
            }}
            onCommit={() => void applyPipeline()}
          />
        </>
      )}
    </fieldset>
  );
};
