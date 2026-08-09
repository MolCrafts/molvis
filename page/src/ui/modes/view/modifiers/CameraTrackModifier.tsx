import type {
  CameraTrackModifier as Core,
  Molvis,
} from "@molcrafts/molvis-stage";
import type React from "react";
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

/**
 * Property panel for the Camera track pipeline step.
 * Playback is driven on the render loop; disabling/deleting the step stops it.
 */
export const CameraTrackModifier: React.FC<Props> = ({
  modifier,
  app,
  onUpdate,
  surface = "full",
}) => {
  const { applyPipeline, pipelineRunning } = useApplyPipelineOperation(
    app,
    onUpdate,
    {
      running: "Updating camera track…",
      success: "Camera track updated",
      error: "Could not update camera track",
    },
  );

  // Draw-only visual step — no compute surface.
  if (surface === "compute") return null;

  return (
    <fieldset
      disabled={!app || pipelineRunning}
      className="m-0 space-y-2 border-0 p-0"
    >
      <p className="px-1 text-micro tabular-nums text-muted-foreground">
        {modifier.keys.length} keys
        {modifier.isPlaying ? " · playing" : " · stopped"}
        {" · "}
        {(modifier.duration / Math.max(modifier.rate, 1e-6)).toFixed(1)}s/lap
      </p>
      <div className="flex items-center justify-between gap-2 px-1">
        <Label className="text-micro">Loop</Label>
        <Switch
          checked={modifier.loop}
          onCheckedChange={(on) => {
            modifier.setLoop(on);
            void applyPipeline();
          }}
        />
      </div>
      <ScalarSliderRow
        label="Duration (content s)"
        value={modifier.duration}
        min={1}
        max={60}
        step={0.5}
        onPreview={(v) => {
          modifier.setDuration(v);
          onUpdate();
        }}
        onCommit={() => void applyPipeline()}
      />
      <ScalarSliderRow
        label="Speed rate"
        value={modifier.rate}
        min={0.1}
        max={4}
        step={0.1}
        format={(v) => `${v.toFixed(1)}×`}
        onPreview={(v) => {
          modifier.setRate(v);
          onUpdate();
        }}
        onCommit={() => void applyPipeline()}
      />
    </fieldset>
  );
};
