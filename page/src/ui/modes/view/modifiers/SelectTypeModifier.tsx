import type {
  SelectTypeModifier as CoreSelectTypeModifier,
  Molvis,
} from "@molcrafts/molvis-stage";
import type React from "react";
import { useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useApplyPipelineOperation } from "@/hooks/useApplyPipelineOperation";

interface Props {
  modifier: CoreSelectTypeModifier;
  app: Molvis | null;
  onUpdate: () => void;
}

const PIPELINE_COPY = {
  running: "Updating type selection…",
  success: "Type selection updated",
  error: "Could not update type selection",
};

function toggleInList(list: readonly string[], value: string): string[] {
  return list.includes(value)
    ? list.filter((x) => x !== value)
    : [...list, value];
}

export const SelectTypeModifier: React.FC<Props> = ({
  modifier,
  app,
  onUpdate,
}) => {
  const { applyPipeline, pipelineRunning } = useApplyPipelineOperation(
    app,
    onUpdate,
    PIPELINE_COPY,
  );

  const frameElements = useMemo(() => {
    const atoms = app?.system?.frame?.getBlock("atoms");
    if (!atoms?.dtype("element")) return [] as string[];
    const els = atoms.copyColStr("element") as string[];
    return [...new Set(els)].sort();
  }, [app, app?.system?.frame]);

  const frameTypes = useMemo(() => {
    const atoms = app?.system?.frame?.getBlock("atoms");
    if (!atoms) return [] as string[];
    if (atoms.dtype("type") === "string") {
      return [...new Set(atoms.copyColStr("type") as string[])].sort();
    }
    if (atoms.dtype("type") === "i32") {
      const col = atoms.viewColI32("type");
      if (!col) return [];
      return [...new Set(Array.from(col, String))].sort(
        (a, b) => Number(a) - Number(b),
      );
    }
    if (atoms.dtype("type") === "u32") {
      const col = atoms.viewColU32("type");
      if (!col) return [];
      return [...new Set(Array.from(col, String))].sort(
        (a, b) => Number(a) - Number(b),
      );
    }
    return [];
  }, [app, app?.system?.frame]);

  return (
    <fieldset
      disabled={!app || pipelineRunning}
      aria-busy={pipelineRunning}
      className="m-0 space-y-3 border-0 p-0"
    >
      {frameElements.length > 0 && (
        <div className="space-y-1.5">
          <Label className="text-micro">Elements in frame</Label>
          <div className="flex flex-wrap gap-1">
            {frameElements.map((el) => {
              const on = modifier.elements.includes(el);
              return (
                <button
                  key={el}
                  type="button"
                  className={
                    on
                      ? "rounded-control bg-primary px-2 py-0.5 text-micro text-primary-foreground"
                      : "rounded-control bg-muted px-2 py-0.5 text-micro text-muted-foreground hover:bg-muted/80"
                  }
                  aria-pressed={on}
                  onClick={() => {
                    modifier.elements = toggleInList(modifier.elements, el);
                    onUpdate();
                    void applyPipeline();
                  }}
                >
                  {el}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {frameTypes.length > 0 && (
        <div className="space-y-1.5">
          <Label className="text-micro">Types in frame</Label>
          <div className="flex flex-wrap gap-1">
            {frameTypes.map((t) => {
              const on = modifier.types.includes(t);
              return (
                <button
                  key={t}
                  type="button"
                  className={
                    on
                      ? "rounded-control bg-primary px-2 py-0.5 text-micro text-primary-foreground"
                      : "rounded-control bg-muted px-2 py-0.5 text-micro text-muted-foreground hover:bg-muted/80"
                  }
                  aria-pressed={on}
                  onClick={() => {
                    modifier.types = toggleInList(modifier.types, t);
                    onUpdate();
                    void applyPipeline();
                  }}
                >
                  {t}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="space-y-1.5">
        <Label className="text-micro" htmlFor="select-type-elements">
          Elements (comma-separated)
        </Label>
        <Input
          id="select-type-elements"
          className="h-8 text-xs"
          key={`el-${modifier.elements.join(",")}`}
          defaultValue={modifier.elements.join(",")}
          placeholder="C, H, O"
          onBlur={(e) => {
            const parts = e.target.value
              .split(/[,\s]+/)
              .map((s) => s.trim())
              .filter(Boolean);
            modifier.elements = parts;
            void applyPipeline();
          }}
        />
      </div>
      <div className="space-y-1.5">
        <Label className="text-micro" htmlFor="select-type-types">
          Types (comma-separated)
        </Label>
        <Input
          id="select-type-types"
          className="h-8 text-xs"
          key={`ty-${modifier.types.join(",")}`}
          defaultValue={modifier.types.join(",")}
          placeholder="1, 2"
          onBlur={(e) => {
            const parts = e.target.value
              .split(/[,\s]+/)
              .map((s) => s.trim())
              .filter(Boolean);
            modifier.types = parts;
            void applyPipeline();
          }}
        />
      </div>
    </fieldset>
  );
};
