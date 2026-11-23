import type { Molvis } from "@molcrafts/molvis-stage";
import {
  NumberField,
  SettingsRow,
  SettingsSection,
  Switch,
} from "@molcrafts/ui";
import type React from "react";
import { useEffect, useState } from "react";

interface GraphicsSectionProps {
  app: Molvis | null;
  sectionId?: string;
}

interface GraphicsState {
  fxaa: boolean;
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
    const sync = () => {
      const gfx = app.settings.getGraphics();
      setState({
        fxaa: gfx.fxaa ?? true,
        hardwareScaling: gfx.hardwareScaling ?? 1.0,
      });
    };
    sync();
    app.events.on("graphics-change", sync);
    return () => app.events.off("graphics-change", sync);
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
