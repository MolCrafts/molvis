import type { Molvis } from "@molcrafts/molvis-stage";
import {
  SettingsRow,
  SettingsSection,
  Switch,
  ToggleAction,
} from "@molcrafts/ui";
import type React from "react";
import { useEffect, useState } from "react";
import { useTheme } from "@/hooks/useTheme";

interface AppearanceSectionProps {
  app: Molvis | null;
  sectionId?: string;
}

/**
 * Page chrome only (light / dark). Scene background and molecular palette
 * live under Settings → Style (stage).
 */
export const AppearanceSection: React.FC<AppearanceSectionProps> = ({
  app,
  sectionId,
}) => {
  const { theme, setTheme } = useTheme();
  const [showFps, setShowFps] = useState(true);

  useEffect(() => {
    if (!app) return;
    const syncShowFps = (show: boolean) => setShowFps(show);
    setShowFps(app.settings.getShowFps());
    app.events.on("show-fps-change", syncShowFps);
    return () => app.events.off("show-fps-change", syncShowFps);
  }, [app]);

  return (
    <SettingsSection id={sectionId} title="Appearance">
      <SettingsRow
        label="Chrome"
        tooltip="Choose the application color scheme."
      >
        <fieldset
          className="inline-flex m-0 gap-1 border-0 p-0"
          aria-label="Chrome theme"
        >
          {(
            [
              { id: "light", label: "Light" },
              { id: "dark", label: "Dark" },
            ] as const
          ).map((opt) => (
            <ToggleAction
              key={opt.id}
              selected={theme === opt.id}
              onClick={() => setTheme(opt.id)}
              className="min-w-12"
            >
              {opt.label}
            </ToggleAction>
          ))}
        </fieldset>
      </SettingsRow>
      <SettingsRow label="Show FPS" tooltip="Show renderer frames per second.">
        <Switch
          aria-label="Show FPS in info panel"
          checked={showFps}
          disabled={!app}
          onCheckedChange={(checked) => {
            setShowFps(checked);
            app?.settings.setShowFps(checked);
          }}
        />
      </SettingsRow>
    </SettingsSection>
  );
};
