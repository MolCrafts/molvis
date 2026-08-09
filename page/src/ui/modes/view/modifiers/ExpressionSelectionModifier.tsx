import type {
  ExpressionSelectionModifier as CoreExpressionModifier,
  Molvis,
} from "@molcrafts/molvis-stage";
import type React from "react";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useApplyPipelineOperation } from "@/hooks/useApplyPipelineOperation";

interface ModifierProps {
  modifier: CoreExpressionModifier;
  app: Molvis | null;
  onUpdate: () => void;
}

const PIPELINE_COPY = {
  running: "Applying the selection expression…",
  success: "Selection expression applied",
  error: "Could not apply the selection expression",
};

export const ExpressionSelectionModifier: React.FC<ModifierProps> = ({
  modifier,
  app,
  onUpdate,
}) => {
  const [expression, setExpression] = useState(modifier.expression);
  const [name, setName] = useState(modifier.selectionName || "");
  const { applyPipeline, pipelineRunning } = useApplyPipelineOperation(
    app,
    onUpdate,
    PIPELINE_COPY,
  );

  const handleApply = () => {
    if (!app || pipelineRunning) return;
    modifier.expression = expression;
    modifier.selectionName = name || undefined;
    applyPipeline();
  };

  return (
    <fieldset
      disabled={!app || pipelineRunning}
      aria-busy={pipelineRunning}
      className="m-0 min-w-0 space-y-2 border-0 p-0 text-xs"
    >
      <div className="space-y-1 px-1">
        <Label htmlFor="expr-input" className="text-micro">
          Expression
        </Label>
        <Input
          id="expr-input"
          value={expression}
          onChange={(e) => setExpression(e.target.value)}
          placeholder="element == 'C'"
          className="h-control-compact font-mono text-xs"
          title="Variables: x, y, z, element, id, index"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              handleApply();
              e.currentTarget.blur();
            }
          }}
          onBlur={handleApply}
        />
      </div>

      <div className="space-y-1 px-1">
        <Label htmlFor="name-input" className="text-micro">
          Name
        </Label>
        <Input
          id="name-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Optional"
          className="h-control-compact text-xs"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              handleApply();
              e.currentTarget.blur();
            }
          }}
          onBlur={handleApply}
        />
      </div>
    </fieldset>
  );
};
