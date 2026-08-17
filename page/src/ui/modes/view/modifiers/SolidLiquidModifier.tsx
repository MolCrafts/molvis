import type {
  SolidLiquidModifier as CoreSolidLiquidModifier,
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
  modifier: CoreSolidLiquidModifier;
  app: Molvis | null;
  onUpdate: () => void;
  surface?: ModifierPanelSurface;
}

const PIPELINE_COPY = {
  running: "Computing solid–liquid labels…",
  success: "Solid–liquid updated",
  error: "Could not compute solid–liquid",
};

export const SolidLiquidModifier: React.FC<Props> = ({
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
            <Label className="text-micro" htmlFor="sl-l">
              ℓ
            </Label>
            <Input
              id="sl-l"
              type="number"
              min={0}
              max={20}
              step={1}
              className="h-8 text-xs"
              value={modifier.l}
              onChange={(e) => {
                modifier.setL(Number(e.target.value));
                onUpdate();
              }}
              onBlur={() => void applyPipeline()}
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
            <Label className="text-micro">Normalize Q</Label>
            <Switch
              checked={modifier.normalizeQ}
              onCheckedChange={(on) => {
                modifier.setNormalizeQ(on);
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
          <div className="flex items-center gap-2">
            <Label className="text-micro text-muted-foreground w-16 shrink-0">
              Liquid
            </Label>
            <input
              type="color"
              value={modifier.liquidColor}
              onChange={(e) => {
                modifier.setLiquidColor(e.target.value);
                void applyPipeline();
              }}
              className="size-control-compact rounded-control cursor-pointer border-0 p-0"
              aria-label="Liquid color"
            />
          </div>
          <div className="flex items-center gap-2">
            <Label className="text-micro text-muted-foreground w-16 shrink-0">
              Solid
            </Label>
            <input
              type="color"
              value={modifier.solidColor}
              onChange={(e) => {
                modifier.setSolidColor(e.target.value);
                void applyPipeline();
              }}
              className="size-control-compact rounded-control cursor-pointer border-0 p-0"
              aria-label="Solid color"
            />
          </div>
        </>
      )}
    </fieldset>
  );
};
