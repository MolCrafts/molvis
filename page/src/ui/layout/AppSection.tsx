import { Download } from "lucide-react";
import { ViewerAction } from "@/components/viewer/ViewerAction";
import { usePwaInstall } from "@/hooks/usePwaInstall";
import { reportStatus } from "@/lib/status-report";
import { SettingsRow, SettingsSection } from "./SettingsSection";

interface AppSectionProps {
  sectionId?: string;
}

/**
 * Install the standalone app. How-to lives on the row tooltip.
 */
export function AppSection({
  sectionId = "app",
}: AppSectionProps): React.ReactElement {
  const { offer, installed, install } = usePwaInstall();

  const onInstall = async () => {
    const result = await install();
    if (result === "accepted") {
      reportStatus("MolVis installed", "success");
    }
  };

  return (
    <SettingsSection id={sectionId} title="App">
      {installed ? (
        <SettingsRow
          label="Install"
          tooltip="MolVis is running as an installed app."
        >
          <span className="text-micro text-muted-foreground">Installed</span>
        </SettingsRow>
      ) : offer.kind === "none" ? (
        <SettingsRow
          label="Install"
          tooltip="This browser cannot install MolVis as an app."
        >
          <span className="text-micro text-muted-foreground">Unavailable</span>
        </SettingsRow>
      ) : (
        <SettingsRow
          label="Install"
          tooltip={
            offer.kind === "ios-tip"
              ? "Safari → Share → Add to Home Screen."
              : "Install MolVis as a standalone app."
          }
        >
          <ViewerAction
            type="button"
            purpose="commit"
            className="gap-1.5"
            onClick={() => void onInstall()}
          >
            <Download className="size-4" aria-hidden />
            {offer.kind === "ios-tip" ? "How to install" : "Install app"}
          </ViewerAction>
        </SettingsRow>
      )}
    </SettingsSection>
  );
}
