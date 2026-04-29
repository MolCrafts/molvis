import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  DrawRibbonModifier as CoreDrawRibbonModifier,
  Molvis,
  RibbonColorMode,
} from "@molvis/core";
import type React from "react";
import { ScalarSliderRow } from "./ScalarSliderRow";

interface DrawRibbonModifierProps {
  modifier: CoreDrawRibbonModifier;
  app: Molvis | null;
  onUpdate: () => void;
}

const COLOR_MODES: ReadonlyArray<{ value: RibbonColorMode; label: string }> = [
  { value: "spectrum", label: "Spectrum (N→C)" },
  { value: "ss", label: "Secondary Structure" },
  { value: "chain", label: "By Chain" },
  { value: "uniform", label: "Uniform" },
];

function rgbToHex(rgb: readonly [number, number, number]): string {
  const to8 = (v: number) => {
    const i = Math.max(0, Math.min(255, Math.round(v * 255)));
    return i.toString(16).padStart(2, "0");
  };
  return `#${to8(rgb[0])}${to8(rgb[1])}${to8(rgb[2])}`;
}

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [0.5, 0.5, 0.5];
  const n = Number.parseInt(m[1], 16);
  return [((n >> 16) & 0xff) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255];
}

export const DrawRibbonModifier: React.FC<DrawRibbonModifierProps> = ({
  modifier,
  app,
  onUpdate,
}) => (
  <div className="space-y-2 text-xs">
    <div className="flex items-center gap-1.5">
      <Label className="text-[10px] text-muted-foreground w-16 shrink-0">
        Coloring
      </Label>
      <Select
        value={modifier.colorMode}
        onValueChange={(v) => {
          modifier.colorMode = v as RibbonColorMode;
          void app?.applyPipeline();
          onUpdate();
        }}
      >
        <SelectTrigger className="h-7 text-xs flex-1 min-w-0">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {COLOR_MODES.map((m) => (
            <SelectItem key={m.value} value={m.value} className="text-xs">
              {m.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>

    {modifier.colorMode === "uniform" && (
      <div className="flex items-center gap-1.5">
        <Label className="text-[10px] text-muted-foreground w-16 shrink-0">
          Color
        </Label>
        <input
          type="color"
          value={rgbToHex(modifier.uniformColor)}
          onChange={(e) => {
            modifier.setUniformColor(hexToRgb(e.target.value));
            void app?.applyPipeline();
            onUpdate();
          }}
          className="w-7 h-7 rounded cursor-pointer border-0 p-0"
          aria-label="Ribbon uniform color"
        />
      </div>
    )}

    <ScalarSliderRow
      label="Width"
      value={modifier.widthScale}
      min={0.25}
      max={3.0}
      step={0.05}
      format={(v) => `${v.toFixed(2)}×`}
      onPreview={(v) => {
        modifier.widthScale = v;
        onUpdate();
      }}
      onCommit={(v) => {
        modifier.widthScale = v;
        void app?.applyPipeline();
        onUpdate();
      }}
    />

    <ScalarSliderRow
      label="Smoothness"
      value={modifier.smoothness}
      min={2}
      max={16}
      step={1}
      format={(v) => `${v}`}
      onPreview={(v) => {
        modifier.smoothness = v;
        onUpdate();
      }}
      onCommit={(v) => {
        modifier.smoothness = v;
        void app?.applyPipeline();
        onUpdate();
      }}
    />

    <ScalarSliderRow
      label="Opacity"
      value={modifier.opacity}
      min={0}
      max={1}
      step={0.05}
      format={(v) => `${Math.round(v * 100)}%`}
      onPreview={(v) => {
        modifier.opacity = v;
        app?.artist.ribbonRenderer.setOpacity(v);
        onUpdate();
      }}
      onCommit={(v) => {
        modifier.opacity = v;
        app?.artist.ribbonRenderer.setOpacity(v);
        onUpdate();
      }}
    />
  </div>
);
