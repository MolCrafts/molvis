import type {
  AffineTransformationModifier as CoreAffine,
  Molvis,
} from "@molcrafts/molvis-stage";
import type React from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useApplyPipelineOperation } from "@/hooks/useApplyPipelineOperation";
import { ScalarSliderRow } from "./ScalarSliderRow";

interface Props {
  modifier: CoreAffine;
  app: Molvis | null;
  onUpdate: () => void;
}

const PIPELINE_COPY = {
  running: "Applying affine transformation…",
  success: "Affine transformation applied",
  error: "Could not apply affine transformation",
};

export const AffineTransformationModifier: React.FC<Props> = ({
  modifier,
  app,
  onUpdate,
}) => {
  const { applyPipeline, pipelineRunning } = useApplyPipelineOperation(
    app,
    onUpdate,
    PIPELINE_COPY,
  );
  const scale = modifier.matrix[0]; // uniform scale shortcut when diagonal

  return (
    <fieldset
      disabled={!app || pipelineRunning}
      aria-busy={pipelineRunning}
      className="m-0 space-y-3 border-0 p-0"
    >
      <ScalarSliderRow
        label="Uniform scale"
        value={scale}
        min={0.1}
        max={5}
        step={0.05}
        onPreview={(s) => {
          modifier.setUniformScale(s);
          onUpdate();
        }}
        onCommit={() => {
          void applyPipeline();
        }}
      />

      <div className="grid grid-cols-3 gap-1.5">
        {(["tx", "ty", "tz"] as const).map((key, i) => (
          <div key={key} className="space-y-1">
            <Label className="text-micro">{key} (Å)</Label>
            <Input
              type="number"
              step={0.1}
              className="h-8 text-xs"
              value={modifier.translation[i]}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (!Number.isFinite(v)) return;
                const t: [number, number, number] = [
                  ...modifier.translation,
                ] as [number, number, number];
                t[i] = v;
                modifier.setTranslation(t);
                onUpdate();
              }}
              onBlur={() => void applyPipeline()}
            />
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between gap-2">
        <Label className="text-micro">Transform simulation cell</Label>
        <Switch
          checked={modifier.transformCell}
          onCheckedChange={(on) => {
            modifier.setTransformCell(on);
            void applyPipeline();
          }}
        />
      </div>
    </fieldset>
  );
};
