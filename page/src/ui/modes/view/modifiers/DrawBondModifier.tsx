import type {
  DrawBondModifier as CoreDrawBondModifier,
  Molvis,
} from "@molcrafts/molvis-stage";
import type React from "react";
import { useApplyPipelineOperation } from "@/hooks/useApplyPipelineOperation";
import { RepresentationSelectRow } from "./RepresentationSelectRow";
import { ScalarSliderRow } from "./ScalarSliderRow";

interface DrawBondModifierProps {
  modifier: CoreDrawBondModifier;
  app: Molvis | null;
  onUpdate: () => void;
}

const PIPELINE_COPY = {
  running: "Updating bond radii…",
  success: "Bond radii updated",
  error: "Could not update bond radii",
};

export const DrawBondModifier: React.FC<DrawBondModifierProps> = ({
  modifier,
  app,
  onUpdate,
}) => {
  const { applyPipeline, pipelineRunning } = useApplyPipelineOperation(
    app,
    onUpdate,
    PIPELINE_COPY,
  );
  const styleDefault = app?.styleManager.getBondStyle(1).radius ?? 0.15;
  const display = modifier.radius ?? styleDefault;
  const isOverride = modifier.radius !== undefined;

  const reset = () => {
    if (!isOverride) return;
    modifier.radius = undefined;
    applyPipeline();
  };

  return (
    <fieldset
      disabled={!app || pipelineRunning}
      aria-busy={pipelineRunning}
      className="m-0 min-w-0 space-y-2 border-0 p-0 text-xs"
    >
      <RepresentationSelectRow app={app} />

      <ScalarSliderRow
        label="Radius"
        value={display}
        min={0.02}
        max={0.5}
        step={0.005}
        format={(v) => v.toFixed(3)}
        onPreview={(v) => {
          modifier.radius = v;
          onUpdate();
        }}
        onCommit={(v) => {
          modifier.radius = v;
          applyPipeline();
        }}
        accessory={
          <button
            type="button"
            onClick={reset}
            disabled={!isOverride}
            className="text-micro text-muted-foreground hover:text-foreground disabled:opacity-40"
            title="Use representation default"
          >
            {isOverride ? "reset" : "default"}
          </button>
        }
      />
    </fieldset>
  );
};
