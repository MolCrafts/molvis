import {
  bondsIntegerColumns,
  type BondColumnRemapModifier as CoreModifier,
  type Molvis,
} from "@molcrafts/molvis-stage";
import {
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
} from "@molcrafts/ui";
import type React from "react";
import { useState } from "react";
import { useApplyPipelineOperation } from "@/hooks/useApplyPipelineOperation";

interface Props {
  modifier: CoreModifier;
  app: Molvis | null;
  onUpdate: () => void;
}

const PIPELINE_COPY = {
  running: "Remapping bond columns…",
  success: "Bond columns remapped",
  error: "Could not remap bond columns",
};

/**
 * Candidate endpoint columns, read from the frame this modifier's own source
 * contributes rather than the composed system frame.
 *
 * The composed frame has already been through this modifier, so it carries
 * `atomi`/`atomj` — offering those back as sources would let the user map the
 * modifier's own output onto its input. The source frame is the pre-remap
 * truth. Falls back to the system frame for a modifier with no source owner.
 */
function endpointCandidates(
  app: Molvis | null,
  modifier: CoreModifier,
): string[] {
  if (!app) return [];
  const owner = app.modifierPipeline
    .sources()
    .find((s) => s.id === modifier.sourceOwnerId);
  if (owner) {
    try {
      return bondsIntegerColumns(owner.cachedFrame);
    } catch {
      // `cachedFrame` throws before the source has preloaded; fall through.
    }
  }
  const frame = app.system.frame;
  return frame ? bondsIntegerColumns(frame) : [];
}

/**
 * Which columns of a bonds block hold the two endpoints.
 *
 * A LAMMPS `dump local` overlay is mapped without asking
 * (`inferBondColumnMapping` claims `batom1`/`batom2` at load time), so this
 * panel is normally a read-back of that inference — and the one place to
 * correct it, or to map a bonds block whose columns molvis could not name.
 */
export const BondColumnRemapModifier: React.FC<Props> = ({
  modifier,
  app,
  onUpdate,
}) => {
  const { applyPipeline, pipelineRunning } = useApplyPipelineOperation(
    app,
    onUpdate,
    PIPELINE_COPY,
  );

  const mapping = modifier.mapping;
  const [offsetDraft, setOffsetDraft] = useState(String(mapping.offset));
  const candidates = endpointCandidates(app, modifier);
  // A mapping already in force may name a column the current frame no longer
  // has (source swapped underneath). Keep it selectable so the panel shows
  // the truth rather than silently blanking.
  const options = [
    ...new Set(
      [...candidates, mapping.atomiSource, mapping.atomjSource].filter(Boolean),
    ),
  ];
  const sameColumn =
    mapping.atomiSource !== "" && mapping.atomiSource === mapping.atomjSource;

  const setEndpoint = (key: "atomiSource" | "atomjSource", column: string) => {
    modifier.mapping = { ...modifier.mapping, [key]: column };
    applyPipeline({ fullRebuild: true });
  };

  const commitOffset = (value: string) => {
    const numeric = Number(value);
    if (!Number.isInteger(numeric)) {
      setOffsetDraft(String(mapping.offset));
      return;
    }
    if (numeric === mapping.offset) return;
    modifier.mapping = { ...modifier.mapping, offset: numeric };
    applyPipeline({ fullRebuild: true });
  };

  return (
    <fieldset
      disabled={!app || pipelineRunning}
      aria-busy={pipelineRunning}
      className="m-0 min-w-0 space-y-4 border-0 p-0 text-label"
    >
      <div className="space-y-1">
        <Label htmlFor="bond-remap-atomi" className="text-label font-semibold">
          First atom
        </Label>
        <Select
          value={mapping.atomiSource}
          onValueChange={(v) => setEndpoint("atomiSource", v)}
        >
          <SelectTrigger
            id="bond-remap-atomi"
            aria-label="First bond endpoint column"
            className="h-control-compact text-label"
          >
            <SelectValue placeholder="Pick a column" />
          </SelectTrigger>
          <SelectContent>
            {options.map((column) => (
              <SelectItem key={column} value={column}>
                {column}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1">
        <Label htmlFor="bond-remap-atomj" className="text-label font-semibold">
          Second atom
        </Label>
        <Select
          value={mapping.atomjSource}
          onValueChange={(v) => setEndpoint("atomjSource", v)}
        >
          <SelectTrigger
            id="bond-remap-atomj"
            aria-label="Second bond endpoint column"
            className="h-control-compact text-label"
          >
            <SelectValue placeholder="Pick a column" />
          </SelectTrigger>
          <SelectContent>
            {options.map((column) => (
              <SelectItem key={column} value={column}>
                {column}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {sameColumn && (
          <p className="text-micro text-status-failed-foreground">
            Both endpoints read the same column — every bond joins an atom to
            itself.
          </p>
        )}
      </div>

      <Separator />

      <div className="space-y-1">
        <Label
          htmlFor="bond-remap-offset"
          className="text-micro text-muted-foreground"
        >
          Row offset (no id column)
        </Label>
        <Input
          id="bond-remap-offset"
          aria-label="Bond endpoint row offset"
          type="number"
          step="1"
          value={offsetDraft}
          onChange={(e) => setOffsetDraft(e.target.value)}
          onBlur={(e) => commitOffset(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitOffset(offsetDraft);
          }}
          className="h-control-compact px-2 text-label"
        />
        <p className="text-micro text-muted-foreground">
          Endpoints are looked up in the atoms block's <code>id</code> column.
          This offset is used only when the atoms have no <code>id</code>, where
          the values are row indices instead — <code>-1</code> for 1-based
          files.
        </p>
      </div>
    </fieldset>
  );
};
