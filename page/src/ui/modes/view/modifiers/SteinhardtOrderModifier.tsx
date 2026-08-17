import type {
  SteinhardtOrderModifier as CoreSteinhardtOrderModifier,
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
  modifier: CoreSteinhardtOrderModifier;
  app: Molvis | null;
  onUpdate: () => void;
  surface?: ModifierPanelSurface;
}

const PIPELINE_COPY = {
  running: "Computing Steinhardt order…",
  success: "Steinhardt order updated",
  error: "Could not compute Steinhardt order",
};

export const SteinhardtOrderModifier: React.FC<Props> = ({
  modifier,
  app,
  onUpdate,
  surface = "full",
}) => {
  const { applyPipeline, pipelineRunning } = useApplyPipelineOperation(
    app,
    onUpdate,
    PIPELINE_COPY,
  );
  const showCompute = surface === "full" || surface === "compute";
  const showDraw = surface === "full" || surface === "draw";

  return (
    <fieldset
      disabled={!app || pipelineRunning}
      aria-busy={pipelineRunning}
      className="m-0 space-y-3 border-0 p-0"
    >
      {showCompute && (
        <>
          <div className="space-y-1.5">
            <Label className="text-micro" htmlFor="steinhardt-l">
              ℓ values (comma-separated)
            </Label>
            <Input
              id="steinhardt-l"
              className="h-8 text-xs"
              defaultValue={modifier.lValues.join(",")}
              onBlur={(e) => {
                const parts = e.target.value
                  .split(/[,\s]+/)
                  .map((s) => Number(s))
                  .filter((n) => Number.isFinite(n));
                if (parts.length === 0) return;
                modifier.setLValues(parts);
                void applyPipeline();
              }}
            />
          </div>

          <ScalarSliderRow
            label="Neighbor cutoff (Å)"
            value={modifier.cutoff}
            min={0.5}
            max={12}
            step={0.1}
            onPreview={(cutoff) => {
              modifier.setCutoff(cutoff);
              onUpdate();
            }}
            onCommit={() => {
              void applyPipeline();
            }}
          />

          <div className="flex items-center justify-between gap-2">
            <Label className="text-micro">Averaged (Lechner–Dellago)</Label>
            <Switch
              checked={modifier.average}
              onCheckedChange={(on) => {
                modifier.setAverage(on);
                void applyPipeline();
              }}
            />
          </div>

          <div className="flex items-center justify-between gap-2">
            <Label className="text-micro">Also write Wℓ</Label>
            <Switch
              checked={modifier.wl}
              onCheckedChange={(on) => {
                modifier.setWl(on);
                void applyPipeline();
              }}
            />
          </div>
        </>
      )}

      {showDraw && (
        <>
          <div className="flex items-center justify-between gap-2">
            <Label className="text-micro">Color scene</Label>
            <Switch
              checked={modifier.colorScene}
              onCheckedChange={(on) => {
                modifier.setColorScene(on);
                void applyPipeline();
              }}
            />
          </div>

          {modifier.colorScene && (
            <div className="space-y-1.5">
              <Label className="text-micro" htmlFor="steinhardt-color-l">
                Color by ℓ
              </Label>
              <Input
                id="steinhardt-color-l"
                type="number"
                min={0}
                max={20}
                step={1}
                className="h-8 text-xs"
                value={modifier.colorL}
                onChange={(e) => {
                  modifier.setColorL(Number(e.target.value));
                  onUpdate();
                }}
                onBlur={() => void applyPipeline()}
              />
            </div>
          )}
        </>
      )}
    </fieldset>
  );
};
