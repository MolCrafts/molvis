import type {
  VectorFieldModifier as CoreVectorFieldModifier,
  Molvis,
} from "@molcrafts/molvis-stage";
import type React from "react";
import { useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useApplyPipelineOperation } from "@/hooks/useApplyPipelineOperation";
import type { ModifierPanelSurface } from "@/plugins/types";
import { ScalarSliderRow } from "./ScalarSliderRow";

interface VectorFieldModifierProps {
  modifier: CoreVectorFieldModifier;
  app: Molvis | null;
  onUpdate: () => void;
  surface?: ModifierPanelSurface;
}

const PIPELINE_COPY = {
  running: "Updating vector field…",
  success: "Vector field updated",
  error: "Could not update vector field",
};

const COLOR_MODES = ["magnitude", "direction", "uniform"] as const;

export const VectorFieldModifier: React.FC<VectorFieldModifierProps> = ({
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
  const cfg = modifier.config;
  const showCompute = surface === "full" || surface === "compute";
  const showDraw = surface === "full" || surface === "draw";

  const floatColumns = useMemo(() => {
    const atoms = app?.frame?.getBlock("atoms");
    if (!atoms) return [] as string[];
    return atoms.keys().filter((k) => atoms.dtype(k) === "f64");
  }, [app]);

  const setCol = (key: "vxCol" | "vyCol" | "vzCol", value: string) => {
    modifier.updateConfig({ [key]: value });
    void applyPipeline();
  };

  return (
    <fieldset
      disabled={!app || pipelineRunning}
      aria-busy={pipelineRunning}
      className="m-0 space-y-3 border-0 p-0"
    >
      {showCompute && (
        <div className="space-y-1.5">
          <Label className="text-micro">Vx / Vy / Vz columns</Label>
          <div className="grid grid-cols-3 gap-1.5">
            {(["vxCol", "vyCol", "vzCol"] as const).map((key, i) => (
              <Select
                key={key}
                value={cfg[key]}
                onValueChange={(v) => setCol(key, v)}
              >
                <SelectTrigger size="sm" className="text-xs" aria-label={key}>
                  <SelectValue placeholder={["vx", "vy", "vz"][i]} />
                </SelectTrigger>
                <SelectContent>
                  {(floatColumns.length > 0 ? floatColumns : [cfg[key]]).map(
                    (col) => (
                      <SelectItem key={col} value={col} className="text-xs">
                        {col}
                      </SelectItem>
                    ),
                  )}
                </SelectContent>
              </Select>
            ))}
          </div>
        </div>
      )}

      {showDraw && (
        <>
          <ScalarSliderRow
            label="Scale"
            value={cfg.scale}
            min={0.001}
            max={10}
            step={0.01}
            onPreview={(scale) => {
              modifier.updateConfig({ scale });
              onUpdate();
            }}
            onCommit={() => {
              void applyPipeline();
            }}
          />

          <div className="space-y-1.5">
            <Label className="text-micro">Color mode</Label>
            <Select
              value={cfg.colorMode}
              onValueChange={(v) => {
                modifier.updateConfig({
                  colorMode: v as (typeof COLOR_MODES)[number],
                });
                void applyPipeline();
              }}
            >
              <SelectTrigger size="sm" className="text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {COLOR_MODES.map((m) => (
                  <SelectItem key={m} value={m} className="text-xs">
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {cfg.colorMode === "uniform" && (
            <div className="space-y-1.5">
              <Label className="text-micro" htmlFor="vf-color">
                Color
              </Label>
              <Input
                id="vf-color"
                type="color"
                value={cfg.color}
                className="h-8 w-full p-1"
                onChange={(e) => {
                  modifier.updateConfig({ color: e.target.value });
                  void applyPipeline();
                }}
              />
            </div>
          )}
        </>
      )}
    </fieldset>
  );
};
