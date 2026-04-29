import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  DrawIsosurfaceModifier as CoreDrawIsosurfaceModifier,
  type IsosurfaceRenderMode,
  type Molvis,
} from "@molvis/core";
import type React from "react";
import { useEffect, useState } from "react";
import { ScalarSliderRow } from "./ScalarSliderRow";

interface DrawIsosurfaceModifierProps {
  modifier: CoreDrawIsosurfaceModifier;
  app: Molvis | null;
  onUpdate: () => void;
}

function rgbToHex(rgb: readonly [number, number, number]): string {
  const to8 = (v: number) => {
    const i = Math.max(0, Math.min(255, Math.round(v * 255)));
    return i.toString(16).padStart(2, "0");
  };
  return `#${to8(rgb[0])}${to8(rgb[1])}${to8(rgb[2])}`;
}

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [0.4, 0.65, 1.0];
  const n = Number.parseInt(m[1], 16);
  return [((n >> 16) & 0xff) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255];
}

/**
 * Pretty label for a grid column. Most channel names are descriptive
 * already (`density`, `total`, `diff`); orbital columns get the index
 * surfaced ("MO 6").
 */
function channelLabel(channel: string): string {
  if (channel.startsWith("mo_")) {
    const idx = channel.slice(3);
    return `MO ${idx}`;
  }
  if (channel === "density") return "Density";
  if (channel === "total") return "Total";
  if (channel === "diff") return "Spin diff";
  if (channel === "mx" || channel === "my" || channel === "mz") {
    return `Magnetization ${channel.slice(1).toUpperCase()}`;
  }
  return channel;
}

export const DrawIsosurfaceModifier: React.FC<DrawIsosurfaceModifierProps> = ({
  modifier,
  app,
  onUpdate,
}) => {
  // Query available channels from the current frame. Re-read whenever
  // the modifier identity or app changes; channels are static for a
  // given file so we don't need a live subscription.
  const [channels, setChannels] = useState<string[]>([]);
  // Isovalue slider bounds derive from the actual data range of the
  // selected channel — keeps the slider centered on values that can
  // produce a non-empty surface. Recompute when the channel changes.
  const [maxAbs, setMaxAbs] = useState<number>(0);
  useEffect(() => {
    const frame = app?.system.frame;
    setChannels(
      frame ? CoreDrawIsosurfaceModifier.availableChannels(frame) : [],
    );
  }, [app]);

  const style = modifier.style;

  useEffect(() => {
    const frame = app?.system.frame;
    if (!frame) {
      setMaxAbs(0);
      return;
    }
    const stats = CoreDrawIsosurfaceModifier.channelStats(frame, style.channel);
    setMaxAbs(stats.maxAbs);
  }, [app, style.channel]);

  // Bound the slider strictly inside the data's magnitude range:
  //  - min: 0.1% of max|v| (any smaller and the surface fills the box)
  //  - max: 95% of max|v| (any larger and no surface exists at all)
  // When the channel is empty / not loaded, fall back to a 0..1 slider
  // so the control still renders sensibly.
  const isoMin = maxAbs > 0 ? maxAbs * 0.001 : 0;
  const isoMax = maxAbs > 0 ? maxAbs * 0.95 : 1.0;
  const isoStep = maxAbs > 0 ? maxAbs / 200 : 0.005;
  // Keep the slider value inside the valid range even if the modifier's
  // stored isovalue was set under a different channel (channel switch
  // triggers a recompute on next pipeline run, but the UI renders before).
  const isoValueClamped = Math.min(Math.max(style.isovalue, isoMin), isoMax);

  return (
    <div className="space-y-2 text-xs">
      <div className="flex items-center gap-1.5">
        <Label className="text-[10px] text-muted-foreground w-16 shrink-0">
          Channel
        </Label>
        <Select
          value={style.channel}
          onValueChange={(v) => {
            modifier.setStyle({ channel: v });
            void app?.applyPipeline();
            onUpdate();
          }}
        >
          <SelectTrigger className="h-7 text-xs flex-1 min-w-0">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {channels.length === 0 ? (
              <SelectItem value={style.channel} className="text-xs" disabled>
                {channelLabel(style.channel)}
              </SelectItem>
            ) : (
              channels.map((c) => (
                <SelectItem key={c} value={c} className="text-xs">
                  {channelLabel(c)}
                </SelectItem>
              ))
            )}
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center gap-1.5">
        <Label className="text-[10px] text-muted-foreground w-16 shrink-0">
          Style
        </Label>
        <Select
          value={style.renderMode}
          onValueChange={(v) => {
            modifier.setStyle({ renderMode: v as IsosurfaceRenderMode });
            void app?.applyPipeline();
            onUpdate();
          }}
        >
          <SelectTrigger className="h-7 text-xs flex-1 min-w-0">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="surface" className="text-xs">
              Surface
            </SelectItem>
            <SelectItem value="cloud" className="text-xs">
              Point cloud
            </SelectItem>
            <SelectItem value="both" className="text-xs">
              Surface + cloud
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      <ScalarSliderRow
        label="Isovalue"
        value={isoValueClamped}
        min={isoMin}
        max={isoMax}
        step={isoStep}
        format={(v) =>
          maxAbs > 0
            ? `${v.toExponential(2)} (${((v / maxAbs) * 100).toFixed(1)}% of max)`
            : v.toFixed(4)
        }
        onPreview={(v) => {
          modifier.setStyle({ isovalue: v });
          onUpdate();
        }}
        onCommit={(v) => {
          modifier.setStyle({ isovalue: v });
          void app?.applyPipeline();
          onUpdate();
        }}
      />

      <div className="flex items-center gap-1.5">
        <Label className="text-[10px] text-muted-foreground w-16 shrink-0">
          Color
        </Label>
        <input
          type="color"
          value={rgbToHex(style.color)}
          onChange={(e) => {
            modifier.setStyle({ color: hexToRgb(e.target.value) });
            void app?.applyPipeline();
            onUpdate();
          }}
          className="w-7 h-7 rounded cursor-pointer border-0 p-0"
          aria-label="Isosurface color"
        />
      </div>

      <ScalarSliderRow
        label="Opacity"
        value={style.opacity}
        min={0}
        max={1}
        step={0.05}
        format={(v) => `${Math.round(v * 100)}%`}
        onPreview={(v) => {
          modifier.setStyle({ opacity: v });
          app?.artist.isosurfaceRenderer.setOpacity(v);
          onUpdate();
        }}
        onCommit={(v) => {
          modifier.setStyle({ opacity: v });
          app?.artist.isosurfaceRenderer.setOpacity(v);
          onUpdate();
        }}
      />

      <div className="flex items-center gap-1.5">
        <Label
          htmlFor={`iso-neg-${modifier.id}`}
          className="text-[10px] text-muted-foreground flex-1 min-w-0"
        >
          Show negative isosurface
        </Label>
        <Switch
          id={`iso-neg-${modifier.id}`}
          checked={style.showNegative}
          onCheckedChange={(v) => {
            modifier.setStyle({ showNegative: v });
            void app?.applyPipeline();
            onUpdate();
          }}
        />
      </div>

      {/* Cloud-only knobs — gated on render mode so the panel stays
          visually compact for plain-surface users. */}
      {(style.renderMode === "cloud" || style.renderMode === "both") && (
        <>
          <ScalarSliderRow
            label="Cloud cut"
            value={style.cloudThreshold}
            min={0}
            max={1}
            step={0.01}
            format={(v) => `${Math.round(v * 100)}% of max`}
            onPreview={(v) => {
              modifier.setStyle({ cloudThreshold: v });
              onUpdate();
            }}
            onCommit={(v) => {
              modifier.setStyle({ cloudThreshold: v });
              void app?.applyPipeline();
              onUpdate();
            }}
          />

          <ScalarSliderRow
            label="Cloud step"
            value={style.cloudStride}
            min={1}
            max={8}
            step={1}
            format={(v) => `every ${v}`}
            onPreview={(v) => {
              modifier.setStyle({ cloudStride: v });
              onUpdate();
            }}
            onCommit={(v) => {
              modifier.setStyle({ cloudStride: v });
              void app?.applyPipeline();
              onUpdate();
            }}
          />

          <div className="flex items-center gap-1.5">
            <Label
              htmlFor={`iso-pbc-${modifier.id}`}
              className="text-[10px] text-muted-foreground flex-1 min-w-0"
            >
              Show PBC images
            </Label>
            <Switch
              id={`iso-pbc-${modifier.id}`}
              checked={style.showPbcImages}
              onCheckedChange={(v) => {
                modifier.setStyle({ showPbcImages: v });
                void app?.applyPipeline();
                onUpdate();
              }}
            />
          </div>
        </>
      )}
    </div>
  );
};
