import type {
  ExpandSelectionModifier as CoreExpandSelectionModifier,
  ExpandSelectionMode,
  Molvis,
} from "@molcrafts/molvis-stage";
import {
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@molcrafts/ui";
import type React from "react";
import { useApplyPipelineOperation } from "@/hooks/useApplyPipelineOperation";
import { ScalarSliderRow } from "./ScalarSliderRow";
import { SelectionHighlightColor } from "./SelectionHighlightColor";

interface Props {
  modifier: CoreExpandSelectionModifier;
  app: Molvis | null;
  onUpdate: () => void;
}

const PIPELINE_COPY = {
  running: "Expanding selection…",
  success: "Selection expanded",
  error: "Could not expand selection",
};

const MODES: ExpandSelectionMode[] = ["cutoff", "bonds", "both"];

export const ExpandSelectionModifier: React.FC<Props> = ({
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
      className="m-0 space-y-3 border-0 p-0"
    >
      <div className="space-y-1.5">
        <Label className="text-micro">Mode</Label>
        <Select
          value={modifier.mode}
          onValueChange={(v) => {
            modifier.mode = v as ExpandSelectionMode;
            void applyPipeline();
          }}
        >
          <SelectTrigger size="sm" className="text-label">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MODES.map((m) => (
              <SelectItem key={m} value={m} className="text-label">
                {m}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {(modifier.mode === "cutoff" || modifier.mode === "both") && (
        <ScalarSliderRow
          label="Cutoff (Å)"
          value={modifier.cutoff}
          min={0.5}
          max={12}
          step={0.1}
          onPreview={(cutoff) => {
            modifier.cutoff = cutoff;
            onUpdate();
          }}
          onCommit={() => {
            void applyPipeline();
          }}
        />
      )}

      <SelectionHighlightColor
        modifier={modifier}
        app={app}
        onUpdate={onUpdate}
      />
    </fieldset>
  );
};
