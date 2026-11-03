import {
  type IsosurfaceModifier as CoreIsosurfaceModifier,
  channelStats,
  gridChannels,
  type Molvis,
} from "@molcrafts/molvis-stage";
import {
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
import { ScalarSliderRow } from "./ScalarSliderRow";

interface Props {
  modifier: CoreIsosurfaceModifier;
  app: Molvis | null;
  onUpdate: () => void;
}

const PIPELINE_COPY = {
  running: "Extracting isosurface…",
  success: "Isosurface updated",
  error: "Could not extract isosurface",
};

/**
 * Pretty label for a grid column. Most channel names are descriptive
 * enough; the orbital ones need the index pulled out.
 */
function channelLabel(channel: string): string {
  if (channel.startsWith("mo_")) return `Orbital ${channel.slice(3)}`;
  if (channel === "density") return "Density";
  if (channel === "total") return "Total";
  if (channel === "diff") return "Spin diff";
  if (channel === "mx" || channel === "my" || channel === "mz") {
    return `Magnetization ${channel.slice(1).toUpperCase()}`;
  }
  return channel;
}

/**
 * Compute side of a grid isosurface: which channel, at what level, and
 * whether the negative lobe is drawn too. Colour and opacity belong to the
 * Draw surface beneath it.
 */
export const IsosurfaceModifier: React.FC<Props> = ({
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
  // Isovalue bounds come from the selected channel's real data range, so the
  // slider stays over values that can actually produce a surface.
  const [stats, setStats] = useState({ maxAbs: 0, signed: false });
  const channel = modifier.channel;

  useEffect(() => {
    const frame = app?.system.frame;
    setChannels(frame ? gridChannels(frame) : []);
  }, [app]);

  useEffect(() => {
    const frame = app?.system.frame;
    setStats(
      frame && channel
        ? channelStats(frame, channel)
        : { maxAbs: 0, signed: false },
    );
  }, [app, channel]);

  // Below 0.1 % of max the surface fills the box; above 95 % none exists.
  const { maxAbs } = stats;
  const isoMin = maxAbs > 0 ? maxAbs * 0.001 : 0;
  const isoMax = maxAbs > 0 ? maxAbs * 0.95 : 1;
  const isoStep = maxAbs > 0 ? maxAbs / 200 : 0.005;
  const isovalue = Math.min(
    Math.max(modifier.isovalue ?? isoMax * 0.05, isoMin),
    isoMax,
  );

  return (
    <fieldset
      disabled={!app || pipelineRunning}
      aria-busy={pipelineRunning}
      className="m-0 min-w-0 space-y-3 border-0 p-0 text-label"
    >
      <div className="space-y-1">
        <Label className="text-label font-semibold">Channel</Label>
        <Select
          value={channel ?? ""}
          onValueChange={(v) => {
            modifier.setChannel(v);
            void applyPipeline();
          }}
        >
          <SelectTrigger
            aria-label="Isosurface channel"
            className="h-control-compact text-label"
          >
            <SelectValue placeholder="Auto" />
          </SelectTrigger>
          <SelectContent>
            {channels.map((name) => (
              <SelectItem key={name} value={name}>
                {channelLabel(name)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <ScalarSliderRow
        label="Isovalue"
        value={isovalue}
        min={isoMin}
        max={isoMax}
        step={isoStep}
        format={(v) =>
          maxAbs > 0
            ? `${v.toExponential(2)} (${((v / maxAbs) * 100).toFixed(1)}% of max)`
            : v.toFixed(4)
        }
        onPreview={(v) => {
          modifier.setIsovalue(v);
          onUpdate();
        }}
        onCommit={() => {
          void applyPipeline();
        }}
      />

      {stats.signed && (
        <div className="flex items-center gap-2">
          <Label
            htmlFor={`iso-neg-${modifier.id}`}
            className="text-micro text-muted-foreground flex-1 min-w-0"
          >
            Negative lobe
          </Label>
          <Switch
            id={`iso-neg-${modifier.id}`}
            aria-label="Draw the negative lobe"
            checked={modifier.showNegative}
            onCheckedChange={(checked) => {
              modifier.setShowNegative(checked);
              void applyPipeline();
            }}
          />
        </div>
      )}
    </fieldset>
  );
};
