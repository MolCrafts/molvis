import type { Molvis } from "@molcrafts/molvis-stage";
import type React from "react";
import { useEffect, useState } from "react";
import { NumberField } from "@/components/ui/number-field";
import { Switch } from "@/components/ui/switch";
import { SettingsRow, SettingsSection } from "./SettingsSection";

interface GraphicsSectionProps {
  app: Molvis | null;
  sectionId?: string;
}

interface GraphicsState {
  fxaa: boolean;
  ssao: boolean;
  dof: boolean;
  hardwareScaling: number;
}

export const GraphicsSection: React.FC<GraphicsSectionProps> = ({
  app,
  sectionId,
}) => {
  const [state, setState] = useState<GraphicsState | null>(null);

  useEffect(() => {
    if (!app) {
      setState(null);
      return;
    }
    const gfx = app.settings.getGraphics();
    setState({
      fxaa: gfx.fxaa ?? true,
      ssao: gfx.ssao ?? false,
      dof: gfx.dof ?? false,
      hardwareScaling: gfx.hardwareScaling ?? 1.0,
    });
  }, [app]);

  const patchGraphics = (partial: Partial<GraphicsState>) => {
    if (!app) return;
    setState((prev) => (prev ? { ...prev, ...partial } : prev));
    app.settings.setGraphics({
      ...app.settings.getGraphics(),
      ...partial,
    });
  };

  return (
    <SettingsSection id={sectionId} title="Graphics">
      {!app || !state ? (
        <p className="text-micro text-muted-foreground">Viewer not ready.</p>
      ) : (
        <>
          <SettingsRow
            label="FXAA"
            tooltip="Smooth jagged edges with fast approximate anti-aliasing."
          >
            <Switch
              aria-label="Enable FXAA"
              checked={state.fxaa}
              onCheckedChange={(c) => patchGraphics({ fxaa: c })}
            />
          </SettingsRow>
          <SettingsRow
            label="SSAO"
            tooltip="Add contact shadows with ambient occlusion."
          >
            <Switch
              aria-label="SSAO"
              checked={state.ssao}
              onCheckedChange={(c) => patchGraphics({ ssao: c })}
            />
          </SettingsRow>
          <SettingsRow
            label="Depth of field"
            tooltip="Blur content away from the orbit target. Focus tracks camera distance."
          >
            <Switch
              aria-label="Depth of field"
              checked={state.dof}
              onCheckedChange={(c) => patchGraphics({ dof: c })}
            />
          </SettingsRow>
          <SettingsRow
            label="Scale"
            tooltip="Adjust render resolution relative to the display."
          >
            <NumberField
              aria-label="Render scale"
              value={state.hardwareScaling}
              min={0.5}
              max={2}
              step={0.1}
              onChange={(v) => patchGraphics({ hardwareScaling: v })}
            />
          </SettingsRow>
        </>
      )}
    </SettingsSection>
  );
};
