import { getColorMap } from "@molcrafts/molvis-stage";
import type React from "react";

export interface ColorScaleLegendProps {
  colorMap: string;
  label: string;
  min?: number;
  max?: number;
}

const SAMPLE_POSITIONS = [0, 0.2, 0.4, 0.6, 0.8, 1] as const;

function formatBound(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return "auto";
  return Number.parseFloat(value.toPrecision(4)).toString();
}

/**
 * Scientific color-map legend. Its colors come from the core color-map
 * registry, so brand/theme tokens never alter scientific meaning.
 */
export const ColorScaleLegend: React.FC<ColorScaleLegendProps> = ({
  colorMap,
  label,
  min,
  max,
}) => {
  const scale = getColorMap(colorMap);
  const gradient = `linear-gradient(to right, ${SAMPLE_POSITIONS.map(
    (position) => {
      const [red, green, blue] = scale.sample(position);
      return `color(srgb-linear ${red} ${green} ${blue}) ${position * 100}%`;
    },
  ).join(", ")})`;
  const minLabel = formatBound(min);
  const maxLabel = formatBound(max);

  return (
    <figure
      className="space-y-1"
      role="img"
      aria-label={`${label}: ${colorMap} scale from ${minLabel} to ${maxLabel}`}
    >
      <div
        className="h-2 w-full rounded-control border border-border"
        style={{ backgroundImage: gradient }}
      />
      <figcaption className="flex items-center justify-between gap-2 font-mono text-micro tabular-nums text-muted-foreground">
        <span>{minLabel}</span>
        <span className="font-sans">{label}</span>
        <span>{maxLabel}</span>
      </figcaption>
    </figure>
  );
};
