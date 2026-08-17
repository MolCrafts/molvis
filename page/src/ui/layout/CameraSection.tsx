import type { Molvis } from "@molcrafts/molvis-stage";
import type React from "react";
import { useEffect, useState } from "react";
import { NumberField } from "@/components/ui/number-field";
import { SettingsRow, SettingsSection } from "./SettingsSection";

interface CameraSectionProps {
  app: Molvis | null;
  sectionId?: string;
}

interface CameraState {
  rotateSpeed: number;
  panSpeed: number;
  zoomSpeed: number;
  inertia: number;
  panInertia: number;
}

export const CameraSection: React.FC<CameraSectionProps> = ({
  app,
  sectionId,
}) => {
  const [state, setState] = useState<CameraState | null>(null);

  useEffect(() => {
    if (!app) {
      setState(null);
      return;
    }
    setState({
      rotateSpeed: app.settings.getCameraRotateSpeed(),
      panSpeed: app.settings.getCameraPanSpeed(),
      zoomSpeed: app.settings.getCameraZoomSpeed(),
      inertia: app.settings.getCameraInertia(),
      panInertia: app.settings.getCameraPanInertia(),
    });
  }, [app]);

  const patch = (partial: Partial<CameraState>, apply: () => void) => {
    setState((prev) => (prev ? { ...prev, ...partial } : prev));
    apply();
  };

  return (
    <SettingsSection id={sectionId} title="Camera">
      {!app || !state ? (
        <p className="text-micro text-muted-foreground">Viewer not ready.</p>
      ) : (
        <>
          <SettingsRow
            label="Rotate"
            tooltip="Set camera rotation sensitivity."
          >
            <NumberField
              aria-label="Camera rotate speed"
              value={state.rotateSpeed}
              min={50}
              max={2000}
              step={25}
              onChange={(v) =>
                patch({ rotateSpeed: v }, () =>
                  app.settings.setCameraRotateSpeed(v),
                )
              }
            />
          </SettingsRow>
          <SettingsRow label="Pan" tooltip="Set camera panning sensitivity.">
            <NumberField
              aria-label="Camera pan speed"
              value={state.panSpeed}
              min={50}
              max={2000}
              step={25}
              onChange={(v) =>
                patch({ panSpeed: v }, () => app.settings.setCameraPanSpeed(v))
              }
            />
          </SettingsRow>
          <SettingsRow label="Zoom" tooltip="Set camera zoom sensitivity.">
            <NumberField
              aria-label="Camera zoom speed"
              value={state.zoomSpeed}
              min={1}
              max={50}
              step={1}
              onChange={(v) =>
                patch({ zoomSpeed: v }, () =>
                  app.settings.setCameraZoomSpeed(v),
                )
              }
            />
          </SettingsRow>
          <SettingsRow
            label="Inertia"
            tooltip="Set rotation and zoom momentum."
          >
            <NumberField
              aria-label="Camera inertia"
              value={state.inertia}
              min={0}
              max={1}
              step={0.05}
              onChange={(v) =>
                patch({ inertia: v }, () => app.settings.setCameraInertia(v))
              }
            />
          </SettingsRow>
          <SettingsRow label="Pan inertia" tooltip="Set panning momentum.">
            <NumberField
              aria-label="Camera pan inertia"
              value={state.panInertia}
              min={0}
              max={1}
              step={0.05}
              onChange={(v) =>
                patch({ panInertia: v }, () =>
                  app.settings.setCameraPanInertia(v),
                )
              }
            />
          </SettingsRow>
        </>
      )}
    </SettingsSection>
  );
};
