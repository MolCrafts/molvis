import {
  type CategoricalThemeId,
  type Molvis,
  REPRESENTATIONS,
  type RepresentationId,
} from "@molcrafts/molvis-stage";
import {
  Atom,
  Circle,
  CircleDot,
  Disc,
  GitBranch,
  Hexagon,
  Layers2,
  Orbit,
  Palette,
  Pencil,
  Square,
  Waypoints,
} from "lucide-react";
import type React from "react";
import { useEffect, useState } from "react";
import { usePipelineOperation } from "@/components/viewer/PipelineOperationProvider";
import { ViewerIconAction } from "@/components/viewer/ViewerIconAction";
import { SettingsRow, SettingsSection } from "./SettingsSection";

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
  flat: Circle,
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

function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (v: number) =>
    Math.round(Math.max(0, Math.min(1, v)) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/**
 * Stage rendering style: representation, element palette, outline, background.
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
  const [outline, setOutline] = useState(
    () => app?.styleManager.getRepresentation().outlineEnabled ?? false,
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
    setOutline(current.outlineEnabled);
    setMolTheme(app.getCategoricalTheme?.() ?? "tab10");
    const cc = app.scene.clearColor;
    setBg(rgbToHex(cc.r, cc.g, cc.b));

    const onRepr = (repr: (typeof REPRESENTATIONS)[number]) => {
      setReprId(repr.id);
      setOutline(repr.outlineEnabled);
    };
    app.events.on("representation-change", onRepr);
    return () => {
      app.events.off("representation-change", onRepr);
    };
  }, [app]);

  const representation = REPRESENTATIONS.find((r) => r.id === reprId);

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
                  <ViewerIconAction
                    key={r.id}
                    icon={<Icon className="size-3.5" />}
                    label={r.name}
                    selected={reprId === r.id}
                    disabled={running}
                    onClick={() => {
                      setReprId(r.id);
                      setOutline(r.outlineEnabled);
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

          {representation?.outlineConfigurable ? (
            <SettingsRow
              label="Outline"
              tooltip="Toggle outlines for the current representation."
            >
              <ViewerIconAction
                icon={<Pencil className="size-3.5" />}
                label={outline ? "Outline on" : "Outline off"}
                selected={outline}
                disabled={running}
                onClick={() => {
                  const next = !outline;
                  setOutline(next);
                  void run(() => app.setRepresentationOutline(next), {
                    running: "…",
                    success: next ? "Outline on" : "Outline off",
                    error: "Failed",
                  });
                }}
              />
            </SettingsRow>
          ) : null}

          <SettingsRow
            label="Theme"
            tooltip="Choose the categorical theme (tab10 or ovito)."
          >
            <fieldset
              className="flex flex-wrap items-center justify-end gap-0.5"
              aria-label="Categorical theme"
            >
              {CATEGORICAL_THEMES.map((t) => (
                <ViewerIconAction
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
                    <ViewerIconAction
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
                  <ViewerIconAction
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
