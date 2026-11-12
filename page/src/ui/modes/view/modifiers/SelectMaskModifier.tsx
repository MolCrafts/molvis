import {
  ArrowUploadRegular as FileUp,
  DismissRegular as XIcon,
} from "@fluentui/react-icons";
import {
  type SelectMaskModifier as CoreSelectMaskModifier,
  MASK_FILE_ACCEPT,
  MaskFileSyntaxError,
  type Molvis,
} from "@molcrafts/molvis-stage";
import { IconAction } from "@molcrafts/ui";
import type React from "react";
import { useRef, useState } from "react";
import { ViewerAction } from "@/components/viewer/ViewerAction";
import { useApplyPipelineOperation } from "@/hooks/useApplyPipelineOperation";
import { reportStatus } from "@/lib/status-report";
import { SelectionHighlightColor } from "./SelectionHighlightColor";

interface Props {
  modifier: CoreSelectMaskModifier;
  app: Molvis | null;
  onUpdate: () => void;
}

const PIPELINE_COPY = {
  running: "Applying the mask selection…",
  success: "Mask selection applied",
  error: "Could not apply the mask selection",
};

/**
 * Property panel for {@link CoreSelectMaskModifier}. Loads a MolVis mask file
 * (`.mask`) and replaces the selector's atom-id set; parse errors are shown
 * inline instead of being silently dropped.
 */
export const SelectMaskModifier: React.FC<Props> = ({
  modifier,
  app,
  onUpdate,
}) => {
  const { applyPipeline, pipelineRunning } = useApplyPipelineOperation(
    app,
    onUpdate,
    PIPELINE_COPY,
  );
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  const loadText = (text: string, sourceName?: string) => {
    try {
      modifier.setMaskText(text, sourceName ? { sourceName } : undefined);
    } catch (e) {
      const message =
        e instanceof MaskFileSyntaxError
          ? e.message
          : "Could not parse the mask file";
      setError(message);
      reportStatus(message, "error");
      return;
    }
    setError(null);
    applyPipeline();
  };

  const pick = () => {
    inputRef.current?.click();
  };

  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    let text: string;
    try {
      text = await file.text();
    } catch {
      const message = "Could not read the mask file";
      setError(message);
      reportStatus(message, "error");
      return;
    }
    loadText(text, file.name);
  };

  const clear = () => {
    loadText("");
  };

  const loaded = modifier.sourceLabel !== null || modifier.ids.length > 0;
  const summary =
    modifier.ids.length > 0
      ? `${modifier.ids.length.toLocaleString()} atoms selected`
      : "Empty mask";

  return (
    <fieldset
      disabled={!app || pipelineRunning}
      aria-busy={pipelineRunning}
      className="m-0 min-w-0 space-y-2 border-0 p-0 text-label"
    >
      <input
        ref={inputRef}
        type="file"
        accept={MASK_FILE_ACCEPT}
        className="hidden"
        onChange={onFileChange}
        aria-hidden="true"
        tabIndex={-1}
      />

      {modifier.sourceLabel ? (
        <p
          className="truncate px-1 font-mono text-label text-muted-foreground"
          title={modifier.sourceLabel}
        >
          {modifier.sourceLabel}
        </p>
      ) : null}

      <p className="px-1 text-micro text-muted-foreground">
        {summary}
        {modifier.expectedCount !== null
          ? ` · file declares ${modifier.expectedCount.toLocaleString()} atoms`
          : ""}
      </p>

      {error ? (
        <p className="break-words px-1 text-micro text-destructive">{error}</p>
      ) : null}

      <div className="flex items-center gap-1 px-1 pt-0.5">
        <ViewerAction
          purpose="commit"
          className="h-control-compact min-w-0 flex-1 justify-start gap-1.5 px-2 text-label"
          onClick={pick}
          title={loaded ? "Replace mask" : "Load mask file"}
        >
          <FileUp className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">
            {loaded ? "Replace mask…" : "Load mask file…"}
          </span>
        </ViewerAction>
        {loaded ? (
          <IconAction icon={<XIcon />} label="Clear mask" onClick={clear} />
        ) : null}
      </div>

      <SelectionHighlightColor
        modifier={modifier}
        app={app}
        onUpdate={onUpdate}
      />
    </fieldset>
  );
};
