import type {
  GaussianDensitySurfaceModifier as CoreGaussianDensitySurfaceModifier,
  Molvis,
} from "@molcrafts/molvis-stage";
import type React from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useApplyPipelineOperation } from "@/hooks/useApplyPipelineOperation";
import type { ModifierPanelSurface } from "@/plugins/types";
import { ScalarSliderRow } from "./ScalarSliderRow";

interface Props {
  modifier: CoreGaussianDensitySurfaceModifier;
  app: Molvis | null;
  onUpdate: () => void;
  surface?: ModifierPanelSurface;
}

const PIPELINE_COPY = {
  running: "Rebuilding Gaussian density surface…",
  success: "Surface updated",
  error: "Could not rebuild surface",
};

function rgbToHex(rgb: readonly [number, number, number]): string {
  const to8 = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v * 255)))
      .toString(16)
      .padStart(2, "0");
  return `#${to8(rgb[0])}${to8(rgb[1])}${to8(rgb[2])}`;
}

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [0.4, 0.65, 1.0];
  const n = Number.parseInt(m[1], 16);
  return [((n >> 16) & 0xff) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255];
}

export const GaussianDensitySurfaceModifier: React.FC<Props> = ({
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
  const style = modifier.style;
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
          <div className="grid grid-cols-3 gap-1.5">
            {(
              [
                ["nx", modifier.nx],
                ["ny", modifier.ny],
                ["nz", modifier.nz],
              ] as const
            ).map(([key, value]) => (
              <div key={key} className="space-y-1">
                <Label className="text-micro">{key}</Label>
                <Input
                  type="number"
                  min={2}
                  max={128}
                  step={1}
                  className="h-8 text-xs"
                  value={value}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    if (!Number.isFinite(n)) return;
                    const nx = key === "nx" ? n : modifier.nx;
                    const ny = key === "ny" ? n : modifier.ny;
                    const nz = key === "nz" ? n : modifier.nz;
                    modifier.setGrid(nx, ny, nz);
                    onUpdate();
                  }}
                  onBlur={() => void applyPipeline()}
                />
              </div>
            ))}
          </div>

          <ScalarSliderRow
            label="Sigma (Å)"
            value={modifier.sigma}
            min={0.1}
            max={5}
            step={0.05}
            onPreview={(sigma) => {
              modifier.setSigma(sigma);
              onUpdate();
            }}
            onCommit={() => {
              void applyPipeline();
            }}
          />
        </>
      )}

      {showDraw && (
        <>
          <ScalarSliderRow
            label="Isovalue"
            value={style.isovalue}
            min={0}
            max={Math.max(style.isovalue * 2, 1)}
            step={Math.max(style.isovalue / 50, 0.001)}
            onPreview={(isovalue) => {
              modifier.setStyle({ isovalue });
              onUpdate();
            }}
            onCommit={() => {
              void applyPipeline();
            }}
          />

          <ScalarSliderRow
            label="Opacity"
            value={style.opacity}
            min={0}
            max={1}
            step={0.05}
            onPreview={(opacity) => {
              modifier.setStyle({ opacity });
              onUpdate();
            }}
            onCommit={() => {
              void applyPipeline();
            }}
          />

          <div className="space-y-1.5">
            <Label className="text-micro" htmlFor="gds-color">
              Color
            </Label>
            <Input
              id="gds-color"
              type="color"
              value={rgbToHex(style.color)}
              className="h-8 w-full p-1"
              onChange={(e) => {
                modifier.setStyle({ color: hexToRgb(e.target.value) });
                void applyPipeline();
              }}
            />
          </div>
        </>
      )}
    </fieldset>
  );
};
