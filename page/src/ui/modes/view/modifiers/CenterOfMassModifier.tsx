import type {
  CenterOfMassModifier as Core,
  Molvis,
} from "@molcrafts/molvis-stage";
import type React from "react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ClusterMaskSelect } from "@/components/viewer/ClusterMaskSelect";
import { useApplyPipelineOperation } from "@/hooks/useApplyPipelineOperation";
import type { ModifierPanelSurface } from "@/plugins/types";
import { ScalarSliderRow } from "./ScalarSliderRow";

interface Props {
  modifier: Core;
  app: Molvis | null;
  onUpdate: () => void;
  surface?: ModifierPanelSurface;
}

export const CenterOfMassModifier: React.FC<Props> = ({
  modifier,
  app,
  onUpdate,
  surface = "full",
}) => {
  const { applyPipeline, pipelineRunning } = useApplyPipelineOperation(
    app,
    onUpdate,
    {
      running: "Updating centers of mass…",
      success: "COM markers updated",
      error: "Could not compute centers of mass",
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
          <ClusterMaskSelect
            app={app}
            value={modifier.maskColumn}
            onChange={(col) => {
              modifier.setMaskColumn(col);
              void applyPipeline();
            }}
          />
          <div className="flex items-center justify-between gap-2">
            <Label className="text-micro">Use mass column when present</Label>
            <Switch
              checked={modifier.useMassColumn}
              onCheckedChange={(on) => {
                modifier.setUseMassColumn(on);
                void applyPipeline();
              }}
            />
          </div>
        </>
      )}
      {showDraw && (
        <ScalarSliderRow
          label="Marker radius (Å)"
          value={modifier.markerRadius}
          min={0.1}
          max={2}
          step={0.05}
          onPreview={(v) => {
            modifier.setMarkerRadius(v);
            onUpdate();
          }}
          onCommit={() => void applyPipeline()}
        />
      )}
    </fieldset>
  );
};
