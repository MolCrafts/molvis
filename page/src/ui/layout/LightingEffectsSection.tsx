import type {
  EffectsSettings,
  LightingSettings,
  Molvis,
} from "@molcrafts/molvis-stage";
import {
  NumberField,
  SettingsRow,
  SettingsSection,
  Switch,
} from "@molcrafts/ui";
import { useEffect, useState } from "react";
import { usePipelineOperation } from "@/components/viewer/PipelineOperationProvider";

export function LightingEffectsSection({
  app,
  sectionId,
}: {
  app: Molvis | null;
  sectionId?: string;
}) {
  const { run, running } = usePipelineOperation();
  const [state, setState] = useState<{
    lighting: LightingSettings;
    effects: EffectsSettings;
  } | null>(null);
  useEffect(() => {
    if (!app) {
      setState(null);
      return;
    }
    const sync = () =>
      setState({
        lighting: app.settings.getLighting(),
        effects: app.settings.getEffects(),
      });
    sync();
    app.events.on("lighting-change", sync);
    app.events.on("effects-change", sync);
    return () => {
      app.events.off("lighting-change", sync);
      app.events.off("effects-change", sync);
    };
  }, [app]);
  const update = (task: () => void) => {
    void run(task, {
      running: "Updating scene lighting and effects…",
      success: "Scene updated",
      error: "Could not update scene",
    });
  };
  return (
    <SettingsSection id={sectionId} title="Lighting & effects">
      {!app || !state ? (
        <p className="text-micro text-muted-foreground">Viewer not ready.</p>
      ) : (
        <fieldset
          disabled={running}
          className="m-0 min-w-0 space-y-3 border-0 p-0"
        >
          <legend className="sr-only">Scene lighting and effects</legend>
          {(["ambient", "diffuse"] as const).map((key) => (
            <SettingsRow
              className="flex-col items-stretch sm:flex-row sm:items-center"
              key={key}
              label={key === "ambient" ? "Ambient light" : "Direct light"}
            >
              <NumberField
                aria-label={
                  key === "ambient" ? "Ambient light" : "Direct light"
                }
                value={state.lighting[key]}
                min={0}
                step={0.05}
                onChange={(value) =>
                  update(() => app.settings.setLighting({ [key]: value }))
                }
              />
            </SettingsRow>
          ))}
          {(["X", "Y", "Z"] as const).map((axis, i) => (
            <SettingsRow
              className="flex-col items-stretch sm:flex-row sm:items-center"
              key={axis}
              label={`Light direction ${axis}`}
            >
              <NumberField
                aria-label={`Light direction ${axis}`}
                value={state.lighting.lightDir[i]}
                step={0.1}
                onChange={(value) => {
                  const lightDir = [...state.lighting.lightDir] as [
                    number,
                    number,
                    number,
                  ];
                  lightDir[i] = value;
                  update(() => app.settings.setLighting({ lightDir }));
                }}
              />
            </SettingsRow>
          ))}
          <SettingsRow
            className="flex-col items-stretch sm:flex-row sm:items-center"
            label="Outlines"
          >
            <Switch
              aria-label="Outlines"
              checked={state.effects.outlineEnabled}
              onCheckedChange={(outlineEnabled) =>
                update(() => app.settings.setEffects({ outlineEnabled }))
              }
            />
          </SettingsRow>
          {state.effects.outlineEnabled &&
            (["atomOutline", "bondOutline"] as const).map((key) => (
              <SettingsRow
                className="flex-col items-stretch sm:flex-row sm:items-center"
                key={key}
                label={
                  key === "atomOutline"
                    ? "Atom outline width"
                    : "Bond outline width"
                }
                tooltip="Width as a fraction of the sphere or cylinder radius."
              >
                <NumberField
                  aria-label={
                    key === "atomOutline"
                      ? "Atom outline width"
                      : "Bond outline width"
                  }
                  value={state.effects[key]}
                  min={0}
                  step={0.01}
                  onChange={(value) =>
                    update(() => app.settings.setEffects({ [key]: value }))
                  }
                />
              </SettingsRow>
            ))}
          <SettingsRow
            className="flex-col items-stretch sm:flex-row sm:items-center"
            label="Ambient occlusion"
            tooltip="Screen-space ambient occlusion strengthens contact shading."
          >
            <Switch
              aria-label="Ambient occlusion"
              checked={state.effects.ssao}
              onCheckedChange={(ssao) =>
                update(() => app.settings.setEffects({ ssao }))
              }
            />
          </SettingsRow>
          <SettingsRow
            className="flex-col items-stretch sm:flex-row sm:items-center"
            label="Depth of field"
            tooltip="Blur content away from the orbit target."
          >
            <Switch
              aria-label="Depth of field"
              checked={state.effects.dof}
              onCheckedChange={(dof) =>
                update(() => app.settings.setEffects({ dof }))
              }
            />
          </SettingsRow>
        </fieldset>
      )}
    </SettingsSection>
  );
}
