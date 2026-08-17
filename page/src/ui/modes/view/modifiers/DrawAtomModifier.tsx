import type {
  DrawAtomModifier as CoreDrawAtomModifier,
  Molvis,
} from "@molcrafts/molvis-stage";
import type React from "react";
import { useApplyPipelineOperation } from "@/hooks/useApplyPipelineOperation";
import { RepresentationSelectRow } from "./RepresentationSelectRow";
import { ScalarSliderRow } from "./ScalarSliderRow";

interface DrawAtomModifierProps {
  modifier: CoreDrawAtomModifier;
  app: Molvis | null;
  onUpdate: () => void;
}

const PIPELINE_COPY = {
  running: "Updating atom radii…",
  success: "Atom radii updated",
  error: "Could not update atom radii",
};

export const DrawAtomModifier: React.FC<DrawAtomModifierProps> = ({
  modifier,
  app,
  onUpdate,
}) => {
  const { applyPipeline, pipelineRunning } = useApplyPipelineOperation(
    app,
    onUpdate,
    PIPELINE_COPY,
  );

  return (
    <fieldset
      disabled={!app || pipelineRunning}
      aria-busy={pipelineRunning}
      className="m-0 min-w-0 space-y-2 border-0 p-0 text-xs"
    >
      <RepresentationSelectRow app={app} />

      <ScalarSliderRow
        label="Radius Scale"
        value={modifier.radiusScale}
        min={0.1}
        max={3.0}
        step={0.05}
        format={(v) => `${v.toFixed(2)}×`}
        onPreview={(v) => {
          modifier.radiusScale = v;
          onUpdate();
        }}
        onCommit={(v) => {
          modifier.radiusScale = v;
          applyPipeline();
        }}
      />
    </fieldset>
  );
};
