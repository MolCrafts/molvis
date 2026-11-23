import {
  MoleculeRegular as Atom,
  CircleRegular as Circle,
  CircleHintRegular as CircleDot,
  RecordRegular as Disc,
  BranchRegular as GitBranch,
  HexagonRegular as Hexagon,
  LayerRegular as Layers2,
  ArrowClockwiseRegular as Orbit,
  ColorRegular as Palette,
  SquareRegular as Square,
  BranchForkRegular as Waypoints,
} from "@fluentui/react-icons";
import {
  type CategoricalThemeId,
  type Molvis,
  REPRESENTATIONS,
  type RepresentationId,
  VISUAL_PRESETS,
} from "@molcrafts/molvis-stage";
import {
  IconAction,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SettingsRow,
  SettingsSection,
} from "@molcrafts/ui";
import type React from "react";
import { useEffect, useState } from "react";
import { usePipelineOperation } from "@/components/viewer/PipelineOperationProvider";

interface StageStyleSectionProps {
  app: Molvis | null;
  sectionId?: string;
}

/**
 * Icons are presentation-only; tooltips use RepresentationStyle.name.
 * Bubble vs spacefill must not share a glyph — they are different radius modes.
 */
const REPR_ICONS: Record<
  RepresentationId,
  React.ComponentType<{ className?: string }>
> = {
  "ball-and-stick": CircleDot,
  "ball-and-tube": Layers2,
  tube: Waypoints,
  "metal-tube": Atom,
  wireframe: Hexagon,
  /** Soft, inflated spheres (theme radii × scale). */
  bubble: Orbit,
  /** Hard VDW spheres packing the molecular surface. */
  spacefill: Disc,
  skeletal: GitBranch,
  graph: Square,
};

const CATEGORICAL_THEMES = [
  {
    id: "tab10" as const,
    label: "tab10",
    swatches: ["#4E79A7", "#F28E2B", "#E15759", "#76B7B2"],
  },
  {
    id: "ovito" as const,
    label: "ovito",
    swatches: ["#F7F7F7", "#FF6666", "#6666FF", "#FFFF00"],
  },
];

function ThemeSwatches({
  swatches,
}: {
  swatches: readonly string[];
}): React.ReactElement {
  return (
    <span className="flex size-3.5 overflow-hidden rounded-[2px]" aria-hidden>
      {swatches.map((hex) => (
        <span
          key={hex}
          className="h-full flex-1"
          style={{ backgroundColor: hex }}
        />
      ))}
    </span>
  );
}

const BG_PRESETS = [
  { label: "Black", value: "#000000" },
  { label: "Babylon", value: "#33334d" },
  { label: "Gray", value: "#808080" },
  { label: "White", value: "#ffffff" },
] as const;

/**
 * Stage rendering style: geometry, complete presets, palette and background.
 * Icon-first controls; full names live in tooltips / aria-labels.
 */
export const StageStyleSection: React.FC<StageStyleSectionProps> = ({
  app,
  sectionId,
}) => {
  const { run, running } = usePipelineOperation();
  const [reprId, setReprId] = useState<RepresentationId>(
    () => app?.styleManager.getRepresentation().id ?? "ball-and-stick",
  );
  const [molTheme, setMolTheme] = useState<CategoricalThemeId>(
    () => app?.getCategoricalTheme?.() ?? "tab10",
  );
  const [bg, setBg] = useState<string | null>(null);

  useEffect(() => {
    if (!app) {
      setBg(null);
      return;
    }
    const current = app.styleManager.getRepresentation();
    setReprId(current.id);
    setMolTheme(app.getCategoricalTheme?.() ?? "tab10");
    setBg(app.getBackgroundColor().slice(0, 7));

    const onRepr = (repr: (typeof REPRESENTATIONS)[number]) => {
      setReprId(repr.id);
    };
    const onColor = () => setMolTheme(app.getCategoricalTheme());
    const onBackground = (value: string) => setBg(value.slice(0, 7));
    app.events.on("representation-change", onRepr);
    app.events.on("coloring-change", onColor);
    app.events.on("background-change", onBackground);
    return () => {
      app.events.off("representation-change", onRepr);
      app.events.off("coloring-change", onColor);
      app.events.off("background-change", onBackground);
    };
  }, [app]);

  const onBg = (hex: string) => {
    if (!app) return;
    app.setBackgroundColor(hex);
    setBg(hex);
  };

  return (
    <SettingsSection id={sectionId} title="Style">
      {!app ? (
        <p className="text-micro text-muted-foreground">Viewer not ready.</p>
      ) : (
        <fieldset
          disabled={running}
          aria-busy={running}
          className="m-0 space-y-3 border-0 p-0"
        >
          <SettingsRow
            label="Representation"
            tooltip="Choose how the molecular structure is rendered."
          >
            <fieldset
              className="flex flex-wrap items-center justify-end gap-0.5"
              aria-label="Representation"
            >
              {REPRESENTATIONS.map((r) => {
                const Icon = REPR_ICONS[r.id] ?? Circle;
                return (
                  <IconAction
                    key={r.id}
                    icon={<Icon className="size-3.5" />}
                    label={r.name}
                    selected={reprId === r.id}
                    disabled={running}
                    onClick={() => {
                      void run(() => app.setRepresentation(r.id), {
                        running: "…",
                        success: r.name,
                        error: "Failed",
                      });
                    }}
                  />
                );
              })}
            </fieldset>
          </SettingsRow>

          <SettingsRow
            className="flex-col items-stretch sm:flex-row sm:items-center"
            label="Visual preset"
            tooltip="Apply geometry, materials, outlines and bond coloring together."
          >
            <Select
              value=""
              onValueChange={(id) => {
                const preset = VISUAL_PRESETS.find((value) => value.id === id);
                if (preset)
                  void run(() => app.applyVisualPreset(preset.id), {
                    running: "Applying visual preset…",
                    success: "Visual preset applied",
                    error: "Could not apply visual preset",
                  });
              }}
            >
              <SelectTrigger
                className="w-full sm:w-48"
                aria-label="Visual preset"
              >
                <SelectValue placeholder="Choose a complete look" />
              </SelectTrigger>
              <SelectContent>
                {VISUAL_PRESETS.map((preset) => (
                  <SelectItem key={preset.id} value={preset.id}>
                    {preset.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </SettingsRow>

          <SettingsRow
            label="Color theme"
            tooltip="Choose the categorical theme (tab10 or ovito)."
          >
            <fieldset
              className="flex flex-wrap items-center justify-end gap-0.5"
              aria-label="Categorical theme"
            >
              {CATEGORICAL_THEMES.map((t) => (
                <IconAction
                  key={t.id}
                  icon={<ThemeSwatches swatches={t.swatches} />}
                  label={t.label}
                  selected={molTheme === t.id}
                  disabled={running}
                  onClick={() => {
                    setMolTheme(t.id);
                    void run(
                      () => {
                        app.setCategoricalTheme(t.id);
                      },
                      {
                        running: "…",
                        success: t.label,
                        error: "Failed",
                      },
                    );
                  }}
                />
              ))}
            </fieldset>
          </SettingsRow>

          {bg ? (
            <SettingsRow
              label="Background"
              tooltip="Choose the 3D scene background color."
            >
              <fieldset
                className="m-0 flex flex-wrap items-center justify-end gap-0.5 border-0 p-0"
                aria-label="Scene background"
              >
                <legend className="sr-only">Scene background</legend>
                {BG_PRESETS.map((p) => {
                  const selected = bg.toLowerCase() === p.value.toLowerCase();
                  return (
                    <IconAction
                      key={p.value}
                      icon={
                        <span
                          className="size-3.5 rounded-[2px]"
                          style={{ backgroundColor: p.value }}
                        />
                      }
                      label={p.label}
                      selected={selected}
                      onClick={() => onBg(p.value)}
                    />
                  );
                })}
                <span className="relative">
                  <IconAction
                    icon={<Palette className="size-3.5" />}
                    label="Custom"
                    selected={
                      !BG_PRESETS.some(
                        (p) => p.value.toLowerCase() === bg.toLowerCase(),
                      )
                    }
                    onClick={() => undefined}
                  />
                  <input
                    type="color"
                    value={bg}
                    onChange={(e) => onBg(e.target.value)}
                    className="absolute inset-0 cursor-pointer opacity-0"
                    aria-label="Custom background"
                  />
                </span>
              </fieldset>
            </SettingsRow>
          ) : null}
        </fieldset>
      )}
    </SettingsSection>
  );
};
