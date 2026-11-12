import { ArrowCounterclockwiseRegular as RotateCcwIcon } from "@fluentui/react-icons";
import type { Molvis } from "@molcrafts/molvis-stage";
import { IconAction, Label } from "@molcrafts/ui";
import type React from "react";
import { useApplyPipelineOperation } from "@/hooks/useApplyPipelineOperation";

interface SelectionHighlightColorProps {
  modifier: { id: string; highlightColor: string | null };
  app: Molvis | null;
  onUpdate: () => void;
}

const FALLBACK_DEFAULT = "#89CFF0";

const PIPELINE_COPY = {
  running: "Updating selection highlight color…",
  success: "Selection highlight color updated",
  error: "Could not update selection highlight color",
};

/**
 * Shared color override for selection-producer property panels. A null
 * `highlightColor` falls back to the theme selection color; picking a color
 * sets the override, and the reset control restores the theme default.
 */
export const SelectionHighlightColor: React.FC<
  SelectionHighlightColorProps
> = ({ modifier, app, onUpdate }) => {
  const { applyPipeline, pipelineRunning } = useApplyPipelineOperation(
    app,
    onUpdate,
    PIPELINE_COPY,
  );

  const themeDefault =
    app?.styleManager?.getTheme()?.selectionColor ?? FALLBACK_DEFAULT;
  const color = modifier.highlightColor ?? themeDefault;
  const isCustom = modifier.highlightColor !== null;

  const handleColorChange = (value: string) => {
    modifier.highlightColor = value;
    applyPipeline();
  };

  const handleReset = () => {
    modifier.highlightColor = null;
    applyPipeline();
  };

  return (
    <div className="grid gap-2">
      <Label htmlFor={`${modifier.id}-highlight-color`}>Highlight Color</Label>
      <div className="flex items-center gap-2">
        <input
          id={`${modifier.id}-highlight-color`}
          type="color"
          value={color}
          disabled={!app || pipelineRunning}
          onChange={(event) => handleColorChange(event.target.value)}
          className="h-9 w-12 cursor-pointer rounded-control border bg-transparent p-1"
          aria-label="Selection highlight color"
        />
        <div className="font-mono text-label text-muted-foreground">
          {color.toUpperCase()}
        </div>
        {isCustom ? (
          <IconAction
            className="ml-auto"
            icon={<RotateCcwIcon />}
            label="Reset highlight color to theme default"
            onClick={handleReset}
            disabled={!app || pipelineRunning}
          />
        ) : null}
      </div>
    </div>
  );
};
