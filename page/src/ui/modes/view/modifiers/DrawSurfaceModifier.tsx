import type {
  DrawSurfaceModifier as CoreDrawSurfaceModifier,
  Molvis,
  SurfaceFinish,
} from "@molcrafts/molvis-stage";
import {
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@molcrafts/ui";
import type React from "react";
import { useApplyPipelineOperation } from "@/hooks/useApplyPipelineOperation";
import { hexToRgb, rgbToHex } from "./color_hex";
import { ScalarSliderRow } from "./ScalarSliderRow";

interface Props {
  modifier: CoreDrawSurfaceModifier;
  app: Molvis | null;
  onUpdate: () => void;
}

const PIPELINE_COPY = {
  running: "Repainting surface…",
  success: "Surface updated",
  error: "Could not repaint surface",
};

const FALLBACK: [number, number, number] = [0.4, 0.65, 1.0];

const FINISHES: ReadonlyArray<{ value: SurfaceFinish; label: string }> = [
  { value: "solid", label: "Solid" },
  { value: "mesh", label: "Wireframe" },
  { value: "contour", label: "Contour" },
  { value: "dot", label: "Stipple" },
];

/**
 * Appearance for any computed surface, whatever produced it.
 *
 * Colour and opacity are pushed straight at the renderer rather than through
 * `applyPipeline`, because nothing about them changes the geometry — and the
 * producer above might be a Delaunay tetrahedralisation nobody wants re-run
 * to darken a blue.
 */
export const DrawSurfaceModifier: React.FC<Props> = ({
  modifier,
  app,
  onUpdate,
}) => {
  const { applyPipeline, pipelineRunning } = useApplyPipelineOperation(
    app,
    onUpdate,
    PIPELINE_COPY,
  );
  const style = modifier.style;
  const repaint = () => {
    app?.artist.surfaceLayer(modifier.id).setColor(modifier.style.color);
    app?.artist.surfaceLayer(modifier.id).setOpacity(modifier.style.opacity);
    onUpdate();
  };

  return (
    <fieldset
      disabled={!app || pipelineRunning}
      aria-busy={pipelineRunning}
      className="m-0 min-w-0 space-y-3 border-0 p-0 text-label"
    >
      <div className="space-y-1.5">
        <Label className="text-micro" htmlFor={`surface-color-${modifier.id}`}>
          Color
        </Label>
        <Input
          id={`surface-color-${modifier.id}`}
          type="color"
          aria-label="Surface color"
          value={rgbToHex(style.color)}
          className="h-control-compact w-full p-1"
          onChange={(e) => {
            modifier.setStyle({ color: hexToRgb(e.target.value, FALLBACK) });
            repaint();
          }}
        />
      </div>

      <ScalarSliderRow
        label="Opacity"
        value={style.opacity}
        min={0}
        max={1}
        step={0.05}
        format={(v) => `${Math.round(v * 100)}%`}
        onPreview={(opacity) => {
          modifier.setStyle({ opacity });
          repaint();
        }}
        onCommit={() => undefined}
      />

      <div className="space-y-1">
        <Label className="text-label font-semibold">Finish</Label>
        <Select
          value={style.finish}
          onValueChange={(v) => {
            modifier.setStyle({ finish: v as SurfaceFinish });
            // The finish is baked into the shader material at build time.
            void applyPipeline();
          }}
        >
          <SelectTrigger
            aria-label="Surface finish"
            className="h-control-compact text-label"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FINISHES.map(({ value, label }) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {style.finish === "contour" && (
        <ScalarSliderRow
          label="Contour spacing (Å)"
          value={style.contourSpacing}
          min={0.05}
          max={3}
          step={0.05}
          onPreview={(contourSpacing) => {
            modifier.setStyle({ contourSpacing });
            onUpdate();
          }}
          onCommit={() => {
            void applyPipeline();
          }}
        />
      )}
    </fieldset>
  );
};
