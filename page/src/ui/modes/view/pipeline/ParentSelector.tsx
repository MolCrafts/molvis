import type { Modifier, Molvis, PipelineEntry } from "@molcrafts/molvis-stage";
import type React from "react";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useApplyPipelineOperation } from "@/hooks/useApplyPipelineOperation";
import { getAvailableParents, getSelectionLabel } from "./tree_utils";

const NONE_VALUE = "__none__";

interface ParentSelectorProps {
  modifier: Modifier;
  allEntries: readonly PipelineEntry[];
  app: Molvis | null;
  onUpdate: () => void;
}

const PIPELINE_COPY = {
  running: "Updating the selection scope…",
  success: "Selection scope updated",
  error: "Could not update the selection scope",
};

export const ParentSelector: React.FC<ParentSelectorProps> = ({
  modifier,
  allEntries,
  app,
  onUpdate,
}) => {
  const { applyPipeline, pipelineRunning } = useApplyPipelineOperation(
    app,
    onUpdate,
    PIPELINE_COPY,
  );
  const parents = getAvailableParents(modifier.id, allEntries);
  const currentValue = modifier.selectionScopeId ?? NONE_VALUE;

  const handleChange = (value: string) => {
    if (!app) return;
    const selectionScopeId = value === NONE_VALUE ? null : value;
    const success = app.modifierPipeline.setSelectionScope(
      modifier.id,
      selectionScopeId,
    );
    if (success) {
      applyPipeline({ fullRebuild: true });
    }
  };

  return (
    <fieldset
      disabled={!app || pipelineRunning}
      aria-busy={pipelineRunning}
      className="m-0 mb-4 min-w-0 space-y-2 border-0 border-b p-0 pb-4"
    >
      <Label htmlFor={`${modifier.id}-selection-scope`} className="text-xs">
        Selection scope
      </Label>
      <Select value={currentValue} onValueChange={handleChange}>
        <SelectTrigger
          id={`${modifier.id}-selection-scope`}
          className="w-full text-xs"
        >
          <SelectValue placeholder="All atoms" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE_VALUE}>All atoms</SelectItem>
          {parents.map((mod) => (
            <SelectItem key={mod.id} value={mod.id}>
              {getSelectionLabel(mod)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </fieldset>
  );
};
