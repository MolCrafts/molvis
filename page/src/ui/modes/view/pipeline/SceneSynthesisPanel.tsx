import {
  ColorByPropertyModifier as CoreColorByPropertyModifier,
  DataSourceModifier,
  type Modifier,
  type Molvis,
  type SceneSynthesisConfig,
} from "@molvis/core";
import type React from "react";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { SidebarSection } from "@/ui/layout/SidebarSection";
import {
  buildSourceLegend,
  formatRmsd,
  selectEnabledDataSources,
} from "../modifiers/scene_synthesis_logic";
import { useSceneSynthesisState } from "./useSceneSynthesisState";

interface Props {
  app: Molvis | null;
  modifiers: readonly Modifier[];
  onUpdate: () => void;
}

const SOURCE_ID_COLUMN = "source_id";

/** Default alignment block when the user first enables alignment. */
const DEFAULT_ALIGNMENT = {
  enabled: true,
  massWeight: false,
  subset: null,
} as const;

/** Human labels for the raw synthesis-mode enum values. */
const MODE_LABEL: Record<SceneSynthesisConfig["mode"], string> = {
  augment: "Augment — overlay in one frame",
  extend: "Extend — concatenate atoms",
};

/**
 * Scene-level synthesis configuration panel. Edits the pipeline's shared
 * {@link SceneSynthesisConfig} (mode / alignment / reference) plus the
 * color-by-source modifier, then re-runs the pipeline head.
 *
 * Every control here only means something across *multiple* sources — how
 * they merge, which one is the alignment reference, how to tell them apart by
 * color. With a single source there is nothing to combine, so the panel stays
 * hidden and the lone source is described entirely by its own pipeline row.
 */
export const SceneSynthesisPanel: React.FC<Props> = ({
  app,
  modifiers,
  onUpdate,
}) => {
  // Re-read per-source RMSD after each pipeline compute.
  useSceneSynthesisState(app);

  const sources = selectEnabledDataSources(modifiers);
  if (!app || sources.length < 2) return null;

  const config = app.modifierPipeline.getSynthesisConfig();
  const alignment = config.alignment;
  const sourceIds = sources.map((s) => s.id);
  const referenceId = config.referenceId ?? sourceIds[0] ?? "";

  const triggerUpdate = () => {
    void app.applyPipeline({ fullRebuild: true });
    onUpdate();
  };

  const setConfig = (next: SceneSynthesisConfig) => {
    app.modifierPipeline.setSynthesisConfig(next);
    triggerUpdate();
  };

  const toggleSource = (id: string, checked: boolean) => {
    const ds = modifiers.find(
      (m): m is DataSourceModifier =>
        m instanceof DataSourceModifier && m.id === id,
    );
    if (!ds) return;
    ds.enabled = checked;
    triggerUpdate();
  };

  const colorBySource = modifiers.find(
    (m): m is CoreColorByPropertyModifier =>
      m instanceof CoreColorByPropertyModifier &&
      m.columnName === SOURCE_ID_COLUMN &&
      m.categorical,
  );

  const toggleColorBySource = (checked: boolean) => {
    if (checked) {
      const mod = new CoreColorByPropertyModifier();
      mod.columnName = SOURCE_ID_COLUMN;
      mod.categorical = true;
      app.modifierPipeline.addModifier(mod);
    } else if (colorBySource) {
      app.modifierPipeline.removeModifier(colorBySource.id);
    }
    triggerUpdate();
  };

  const rmsdFor = (id: string): number | null => {
    if (id === referenceId) return null;
    return app.frame?.getMetaScalar(`synthesis_rmsd:${id}`) ?? null;
  };

  const colorEnabled = colorBySource !== undefined;
  // Source → swatch. Folded into the checklist so "which source is which
  // color" reads in one place instead of a detached legend at the bottom.
  const sourceColor = new Map(
    buildSourceLegend(sourceIds).map((e) => [e.label, e.color]),
  );

  return (
    <SidebarSection
      title="Sources"
      subtitle="Combine multiple loaded sources"
      badge={String(sources.length)}
    >
      <div className="space-y-2 text-xs">
        {/* Source checklist — toggle a source in/out of the combined scene. */}
        <div className="space-y-0.5">
          {sources.map((s) => (
            <div
              key={s.id}
              className="flex items-center gap-2 rounded-sm px-1 py-1 hover:bg-muted/40"
            >
              <Checkbox
                checked
                onCheckedChange={(c) => toggleSource(s.id, c === true)}
                aria-label={`Include source ${s.id}`}
              />
              {colorEnabled && (
                <span
                  className="h-2.5 w-2.5 rounded-full shrink-0 ring-1 ring-black/10"
                  style={{ backgroundColor: sourceColor.get(s.id) }}
                />
              )}
              <span className="flex-1 min-w-0 truncate">{s.name}</span>
              <span className="text-[9px] text-muted-foreground font-mono truncate">
                {s.id}
              </span>
            </div>
          ))}
        </div>

        <Separator />

        {/* Merge mode */}
        <div className="space-y-1">
          <span className="text-[10px] text-muted-foreground">Combine as</span>
          <Select
            value={config.mode}
            onValueChange={(v) =>
              setConfig({ ...config, mode: v as SceneSynthesisConfig["mode"] })
            }
          >
            <SelectTrigger className="h-7 text-xs w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="augment">{MODE_LABEL.augment}</SelectItem>
              <SelectItem value="extend">{MODE_LABEL.extend}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Separator />

        {/* Alignment */}
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <Checkbox
              checked={alignment?.enabled === true}
              onCheckedChange={(c) =>
                setConfig({
                  ...config,
                  alignment:
                    c === true
                      ? { ...(alignment ?? DEFAULT_ALIGNMENT), enabled: true }
                      : alignment
                        ? { ...alignment, enabled: false }
                        : null,
                })
              }
              aria-label="Align sources to a reference"
            />
            <span className="font-medium">Align to reference</span>
          </div>

          {alignment?.enabled && (
            <div className="space-y-1.5 pl-6">
              <div className="flex items-center gap-2">
                <span className="w-8 shrink-0 text-[10px] text-muted-foreground">
                  Ref
                </span>
                <Select
                  value={referenceId}
                  onValueChange={(v) =>
                    setConfig({ ...config, referenceId: v })
                  }
                >
                  <SelectTrigger className="h-7 text-xs flex-1 min-w-0">
                    <SelectValue placeholder="Reference source" />
                  </SelectTrigger>
                  <SelectContent>
                    {sources.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        <span className="font-mono">{s.id}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center gap-2">
                <Checkbox
                  checked={alignment.massWeight}
                  onCheckedChange={(c) =>
                    setConfig({
                      ...config,
                      alignment: { ...alignment, massWeight: c === true },
                    })
                  }
                  aria-label="Mass-weighted alignment"
                />
                <span className="text-[10px] text-muted-foreground">
                  Mass-weighted
                </span>
              </div>

              {/* RMSD-to-reference readout */}
              <div className="rounded-sm border bg-muted/20 divide-y">
                {sourceIds.map((id) => (
                  <div
                    key={id}
                    className="flex items-center gap-2 px-2 py-1 text-[10px]"
                  >
                    <span className="flex-1 min-w-0 truncate font-mono text-muted-foreground">
                      {id}
                    </span>
                    <span className="font-mono tabular-nums text-foreground">
                      {formatRmsd(rmsdFor(id))}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <Separator />

        {/* Color by source */}
        <div className="flex items-center gap-2">
          <Checkbox
            checked={colorEnabled}
            onCheckedChange={(c) => toggleColorBySource(c === true)}
            aria-label="Color atoms by their source"
          />
          <span className="font-medium">Color by source</span>
        </div>
      </div>
    </SidebarSection>
  );
};
