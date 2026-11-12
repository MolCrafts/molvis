import {
  type VolumeCloudModifier as CoreVolumeCloudModifier,
  gridChannels,
  type Molvis,
} from "@molcrafts/molvis-stage";
import {
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
} from "@molcrafts/ui";
import type React from "react";
import { useEffect, useState } from "react";
import { useApplyPipelineOperation } from "@/hooks/useApplyPipelineOperation";
import { hexToRgb, rgbToHex } from "./color_hex";
import { ScalarSliderRow } from "./ScalarSliderRow";

interface Props {
  modifier: CoreVolumeCloudModifier;
  app: Molvis | null;
  onUpdate: () => void;
}

const PIPELINE_COPY = {
  running: "Rebuilding volume cloud…",
  success: "Volume cloud updated",
  error: "Could not rebuild volume cloud",
};

const FALLBACK: [number, number, number] = [0.4, 0.65, 1.0];

/**
 * Every voxel as a point sprite — the whole field rather than one level set,
 * which is why it is its own step and not a mode on the isosurface.
 */
export const VolumeCloudModifier: React.FC<Props> = ({
  modifier,
  app,
  onUpdate,
}) => {
  const { applyPipeline, pipelineRunning } = useApplyPipelineOperation(
    app,
    onUpdate,
    PIPELINE_COPY,
  );
  const [channels, setChannels] = useState<string[]>([]);
  const style = modifier.style;

  useEffect(() => {
    const frame = app?.system.frame;
    setChannels(frame ? gridChannels(frame) : []);
  }, [app]);

  const commit = () => {
    void applyPipeline();
  };

  return (
    <fieldset
      disabled={!app || pipelineRunning}
      aria-busy={pipelineRunning}
      className="m-0 min-w-0 space-y-3 border-0 p-0 text-label"
    >
      <div className="space-y-1">
        <Label className="text-label font-semibold">Channel</Label>
        <Select
          value={modifier.channel ?? ""}
          onValueChange={(v) => {
            modifier.setChannel(v);
            commit();
          }}
        >
          <SelectTrigger
            aria-label="Volume cloud channel"
            className="h-control-compact text-label"
          >
            <SelectValue placeholder="Auto" />
          </SelectTrigger>
          <SelectContent>
            {channels.map((name) => (
              <SelectItem key={name} value={name}>
                {name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <ScalarSliderRow
        label="Threshold"
        value={style.threshold}
        min={0}
        max={1}
        step={0.01}
        format={(v) => `${Math.round(v * 100)}% of max`}
        onPreview={(threshold) => {
          modifier.setStyle({ threshold });
          onUpdate();
        }}
        onCommit={commit}
      />

      <ScalarSliderRow
        label="Stride"
        value={style.stride}
        min={1}
        max={8}
        step={1}
        format={(v) => `every ${v.toFixed(0)}`}
        onPreview={(stride) => {
          modifier.setStyle({ stride });
          onUpdate();
        }}
        onCommit={commit}
      />

      <ScalarSliderRow
        label="Opacity"
        value={style.opacity}
        min={0}
        max={1}
        step={0.05}
        format={(v) => `${Math.round(v * 100)}%`}
        onPreview={(opacity) => {
          modifier.setStyle({ opacity });
          onUpdate();
        }}
        onCommit={commit}
      />

      <div className="space-y-1.5">
        <Label className="text-micro" htmlFor={`cloud-color-${modifier.id}`}>
          Color
        </Label>
        <Input
          id={`cloud-color-${modifier.id}`}
          type="color"
          aria-label="Volume cloud color"
          value={rgbToHex(style.color)}
          className="h-control-compact w-full p-1"
          onChange={(e) => {
            modifier.setStyle({ color: hexToRgb(e.target.value, FALLBACK) });
            commit();
          }}
        />
      </div>

      <div className="flex items-center gap-2">
        <Label
          htmlFor={`cloud-pbc-${modifier.id}`}
          className="text-micro text-muted-foreground flex-1 min-w-0"
        >
          Periodic images
        </Label>
        <Switch
          id={`cloud-pbc-${modifier.id}`}
          aria-label="Draw periodic images"
          checked={style.showPbcImages}
          onCheckedChange={(showPbcImages) => {
            modifier.setStyle({ showPbcImages });
            commit();
          }}
        />
      </div>
    </fieldset>
  );
};
