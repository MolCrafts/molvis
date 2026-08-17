import type {
  SliceModifier as CoreSliceModifier,
  Molvis,
} from "@molcrafts/molvis-stage";
import { RotateCcw } from "lucide-react";
import type React from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { ViewerIconAction } from "@/components/viewer/ViewerIconAction";
import { useApplyPipelineOperation } from "@/hooks/useApplyPipelineOperation";

interface SliceModifierProps {
  modifier: CoreSliceModifier;
  app: Molvis | null;
  onUpdate: () => void;
}

const PIPELINE_COPY = {
  running: "Updating the slice…",
  success: "Slice updated",
  error: "Could not update the slice",
};

export const SliceModifier: React.FC<SliceModifierProps> = ({
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
    applyPipeline();
  };

  const updateOffset = (value: string) => {
    const numeric = Number(value);
    if (Number.isNaN(numeric)) {
      throw new Error("Slice offset must be a number");
    }
    modifier.offset = numeric;
    triggerUpdate();
  };

  const updateNormal = (idx: 0 | 1 | 2, value: string) => {
    const numeric = Number(value);
    if (Number.isNaN(numeric)) {
      throw new Error("Slice normal component must be a number");
    }
    const newNormal: [number, number, number] = [
      modifier.normal[0],
      modifier.normal[1],
      modifier.normal[2],
    ];
    newNormal[idx] = numeric;
    modifier.normal = newNormal;
    triggerUpdate();
  };

  const handleResetNormal = () => {
    modifier.normal = [1, 0, 0];
    triggerUpdate();
  };

  let minOffset = -100;
  let maxOffset = 100;

  if (modifier.bounds) {
    const { min, max } = modifier.bounds;
    const cx = (min[0] + max[0]) / 2;
    const cy = (min[1] + max[1]) / 2;
    const cz = (min[2] + max[2]) / 2;

    const dx = max[0] - min[0];
    const dy = max[1] - min[1];
    const dz = max[2] - min[2];
    const radius = Math.sqrt(dx * dx + dy * dy + dz * dz) / 2;

    const n = modifier.normal;
    const len = Math.sqrt(n[0] * n[0] + n[1] * n[1] + n[2] * n[2]);
    const nx = len > 1e-6 ? n[0] / len : 1;
    const ny = len > 1e-6 ? n[1] / len : 0;
    const nz = len > 1e-6 ? n[2] / len : 0;

    const centerProj = cx * nx + cy * ny + cz * nz;
    const padding = radius * 0.2;
    minOffset = centerProj - radius - padding;
    maxOffset = centerProj + radius + padding;
  }

  return (
    <fieldset
      disabled={!app || pipelineRunning}
      aria-busy={pipelineRunning}
      className="m-0 min-w-0 space-y-4 border-0 p-0 text-xs"
    >
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs font-semibold">Normal Vector</Label>
          <ViewerIconAction
            icon={<RotateCcw />}
            label="Reset normal vector"
            onClick={handleResetNormal}
          />
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div className="space-y-1">
            <Label className="text-micro text-muted-foreground">X</Label>
            <Input
              aria-label="Slice normal X"
              type="number"
              step="0.1"
              value={modifier.normal[0]}
              onChange={(e) => updateNormal(0, e.target.value)}
              className="h-control-compact px-2 text-xs"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-micro text-muted-foreground">Y</Label>
            <Input
              aria-label="Slice normal Y"
              type="number"
              step="0.1"
              value={modifier.normal[1]}
              onChange={(e) => updateNormal(1, e.target.value)}
              className="h-control-compact px-2 text-xs"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-micro text-muted-foreground">Z</Label>
            <Input
              aria-label="Slice normal Z"
              type="number"
              step="0.1"
              value={modifier.normal[2]}
              onChange={(e) => updateNormal(2, e.target.value)}
              className="h-control-compact px-2 text-xs"
            />
          </div>
        </div>
      </div>

      <Separator />

      <div className="space-y-1">
        <div className="flex justify-between">
          <Label className="text-xs font-semibold">Offset</Label>
          <span className="text-micro text-muted-foreground font-mono">
            {modifier.offset.toFixed(2)}
          </span>
        </div>
        <div className="flex gap-2 items-center">
          <Input
            aria-label="Slice offset"
            type="range"
            min={minOffset}
            max={maxOffset}
            step="0.1"
            value={modifier.offset}
            onChange={(e) => updateOffset(e.target.value)}
            className="h-6"
          />
          <Input
            aria-label="Slice offset value"
            type="number"
            value={modifier.offset}
            onChange={(e) => updateOffset(e.target.value)}
            className="w-16 h-control-compact px-2 text-xs"
          />
        </div>
      </div>

      <Separator />

      <div className="flex items-center justify-between">
        <Label className="text-xs">Slab Mode</Label>
        <Checkbox
          aria-label="Enable slab mode"
          checked={modifier.isSlab}
          onCheckedChange={(checked) => {
            modifier.isSlab = checked === true;
            triggerUpdate();
          }}
        />
      </div>

      {modifier.isSlab && (
        <div className="space-y-1 pl-2 border-l-2 border-muted ml-1">
          <Label className="text-micro text-muted-foreground">Thickness</Label>
          <div className="flex gap-2">
            <Input
              aria-label="Slab thickness"
              type="number"
              min="0.1"
              step="0.5"
              value={modifier.slabThickness}
              onChange={(e) => {
                const numeric = Number(e.target.value);
                if (Number.isNaN(numeric)) {
                  throw new Error("Slice slab thickness must be a number");
                }
                modifier.slabThickness = numeric;
                triggerUpdate();
              }}
              className="h-control-compact px-2 text-xs"
            />
          </div>
        </div>
      )}

      <Separator />

      <div className="flex items-center justify-between">
        <Label className="text-xs">Invert Selection</Label>
        <Checkbox
          aria-label="Invert slice selection"
          checked={modifier.invert}
          onCheckedChange={(checked) => {
            modifier.invert = checked === true;
            triggerUpdate();
          }}
        />
      </div>
    </fieldset>
  );
};
