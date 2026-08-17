import type {
  ColorByPropertyModifier as CoreModifier,
  Molvis,
} from "@molcrafts/molvis-stage";
import type React from "react";
import { ColorScaleLegend } from "@/components/scientific/ColorScaleLegend";
import { Checkbox } from "@/components/ui/checkbox";
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
  running: "Recoloring the structure…",
  success: "Structure colors updated",
  error: "Could not apply property colors",
};

export const ColorByPropertyModifier: React.FC<Props> = ({
  modifier,
  app,
  onUpdate,
}) => {
  const { applyPipeline, pipelineRunning } = useApplyPipelineOperation(
    app,
    onUpdate,
    PIPELINE_COPY,
  );

  // Populate UI-facing metadata from the current frame
  const frame = app?.system?.frame ?? null;
  if (frame) {
    modifier.inspect(frame);
  }

  const triggerUpdate = () => {
    applyPipeline({ fullRebuild: true });
  };

  const columns = modifier.availableColumns;
  const isNumeric =
    modifier.columnName &&
    columns.some(
      (c) =>
        c.name === modifier.columnName &&
        (c.dtype === "f32" ||
          c.dtype === "f64" ||
          c.dtype === "i32" ||
          c.dtype === "u32" ||
          c.dtype === "u8"),
    );

  const detected = modifier.detectedRange;
  const hasManualRange = modifier.range !== null;

  return (
    <fieldset
      disabled={!app || pipelineRunning}
      aria-busy={pipelineRunning}
      className="m-0 min-w-0 space-y-4 border-0 p-0 text-xs"
    >
      {/* Column selector */}
      <div className="space-y-1">
        <Label className="text-xs font-semibold">Column</Label>
        <Select
          value={modifier.columnName || "__none__"}
          onValueChange={(v) => {
            modifier.columnName = v === "__none__" ? "" : v;
            modifier.range = null;
            triggerUpdate();
          }}
        >
          <SelectTrigger
            aria-label="Color property column"
            className="h-control-compact text-xs"
          >
            <SelectValue placeholder="Select column..." />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">
              <span className="text-muted-foreground">(default colors)</span>
            </SelectItem>
            {columns.map((col) => (
              <SelectItem key={col.name} value={col.name}>
                <span className="font-mono">{col.name}</span>
                <span className="ml-2 text-micro text-muted-foreground">
                  {col.dtype}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {modifier.columnName && isNumeric && (
        <>
          {/* Range controls */}
          <Separator />
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-semibold">Range</Label>
              <div className="flex items-center gap-2">
                <Label className="text-micro text-muted-foreground">Auto</Label>
                <Checkbox
                  aria-label="Use automatic color range"
                  checked={!hasManualRange}
                  onCheckedChange={(checked) => {
                    if (checked) {
                      modifier.range = null;
                    } else {
                      modifier.range = detected ?? { min: 0, max: 1 };
                    }
                    triggerUpdate();
                  }}
                />
              </div>
            </div>

            {detected && (
              <div className="text-micro text-muted-foreground font-mono">
                Detected: [{detected.min.toFixed(3)}, {detected.max.toFixed(3)}]
              </div>
            )}

            <ColorScaleLegend
              colorMap="viridis"
              label={modifier.columnName}
              min={(modifier.range ?? detected)?.min}
              max={(modifier.range ?? detected)?.max}
            />

            {hasManualRange && modifier.range && (
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label
                    htmlFor={`${modifier.id}-color-range-min`}
                    className="text-micro text-muted-foreground"
                  >
                    Min
                  </Label>
                  <Input
                    id={`${modifier.id}-color-range-min`}
                    type="number"
                    step="0.1"
                    value={modifier.range.min}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      if (!Number.isNaN(v) && modifier.range) {
                        modifier.range = { ...modifier.range, min: v };
                        triggerUpdate();
                      }
                    }}
                    className="h-control-compact px-2 text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <Label
                    htmlFor={`${modifier.id}-color-range-max`}
                    className="text-micro text-muted-foreground"
                  >
                    Max
                  </Label>
                  <Input
                    id={`${modifier.id}-color-range-max`}
                    type="number"
                    step="0.1"
                    value={modifier.range.max}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      if (!Number.isNaN(v) && modifier.range) {
                        modifier.range = { ...modifier.range, max: v };
                        triggerUpdate();
                      }
                    }}
                    className="h-control-compact px-2 text-xs"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Clamp toggle */}
          <div className="flex items-center justify-between">
            <Label
              htmlFor={`${modifier.id}-clamp-color-range`}
              className="text-xs"
            >
              Clamp out-of-range
            </Label>
            <Checkbox
              id={`${modifier.id}-clamp-color-range`}
              checked={modifier.clampOutOfRange}
              onCheckedChange={(checked) => {
                modifier.clampOutOfRange = checked === true;
                triggerUpdate();
              }}
            />
          </div>
        </>
      )}
    </fieldset>
  );
};
