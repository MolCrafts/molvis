import type {
  CoordinationPolyhedraModifier as Core,
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

export const CoordinationPolyhedraModifier: React.FC<Props> = ({
  modifier,
  app,
  onUpdate,
  surface = "full",
}) => {
  const { applyPipeline, pipelineRunning } = useApplyPipelineOperation(
    app,
    onUpdate,
    {
      running: "Building polyhedra…",
      success: "Polyhedra updated",
      error: "Could not build polyhedra",
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
          <ScalarSliderRow
            label="Cutoff (Å)"
            value={modifier.cutoff}
            min={0.5}
            max={8}
            step={0.1}
            onPreview={(c) => {
              modifier.setCutoff(c);
              onUpdate();
            }}
            onCommit={() => void applyPipeline()}
          />
          <div className="flex items-center justify-between gap-2">
            <Label className="text-micro">Only selection as centers</Label>
            <Switch
              checked={modifier.onlySelection}
              onCheckedChange={(on) => {
                modifier.setOnlySelection(on);
                void applyPipeline();
              }}
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
