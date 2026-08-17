import type { Molvis } from "@molcrafts/molvis-stage";
import type React from "react";
import { useEffect, useState } from "react";
import { Switch } from "@/components/ui/switch";
import { useTheme } from "@/hooks/useTheme";
import { cn } from "@/lib/utils";
import { SettingsRow, SettingsSection } from "./SettingsSection";

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
          className="inline-flex m-0 rounded-control border border-border p-0.5"
          aria-label="Chrome theme"
        >
          {(
            [
              { id: "light", label: "Light" },
              { id: "dark", label: "Dark" },
            ] as const
          ).map((opt) => (
            <button
              key={opt.id}
              type="button"
              className={cn(
                "h-6 min-w-12 px-2 text-micro rounded-[calc(var(--radius-control)-2px)] transition-colors duration-(--motion-fast) ease-standard",
                theme === opt.id
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-interactive hover:text-foreground",
              )}
              aria-pressed={theme === opt.id}
              onClick={() => setTheme(opt.id)}
            >
              {opt.label}
            </button>
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
