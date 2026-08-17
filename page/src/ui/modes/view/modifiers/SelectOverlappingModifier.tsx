import type {
  SelectOverlappingModifier as Core,
  Molvis,
} from "@molcrafts/molvis-stage";
import type React from "react";
import { useApplyPipelineOperation } from "@/hooks/useApplyPipelineOperation";
import { ScalarSliderRow } from "./ScalarSliderRow";

interface Props {
  modifier: Core;
  app: Molvis | null;
  onUpdate: () => void;
}

export const SelectOverlappingModifier: React.FC<Props> = ({
  modifier,
  app,
  onUpdate,
}) => {
  const { applyPipeline, pipelineRunning } = useApplyPipelineOperation(
    app,
    onUpdate,
    {
      running: "Selecting overlapping…",
      success: "Overlapping selection updated",
      error: "Could not select overlapping",
    },
  );
  return (
    <fieldset
      disabled={!app || pipelineRunning}
      className="m-0 space-y-3 border-0 p-0"
    >
      <ScalarSliderRow
        label="Cutoff (Å)"
        value={modifier.cutoff}
        min={0.05}
        max={5}
        step={0.05}
        onPreview={(c) => {
          modifier.setCutoff(c);
          onUpdate();
        }}
        onCommit={() => void applyPipeline()}
      />
    </fieldset>
  );
};
