import { Download, Share2 } from "lucide-react";
import { useMemo } from "react";
import { ViewerAction } from "@/components/viewer/ViewerAction";
import { usePwaInstall } from "@/hooks/usePwaInstall";
import {
  buildShareUrl,
  readRememberedShareable,
  shareOrCopyUrl,
} from "@/lib/open-structure";
import { detectClientPlatform, openStructureHelp } from "@/lib/platform";
import { reportStatus } from "@/lib/status-report";
import { SettingsSection } from "./SettingsSection";

interface AppSharingSectionProps {
  sectionId?: string;
}

/**
 * Install + how-to-open guidance for the current device.
 * Lives under Settings so desktop and mobile share one place.
 */
export function AppSharingSection({
  sectionId = "app-sharing",
}: AppSharingSectionProps): React.ReactElement {
  const platform = useMemo(() => detectClientPlatform(), []);
  const { offer, installed, install, showIosTip } = usePwaInstall();
  const help = useMemo(
    () => openStructureHelp(platform, installed),
    [platform, installed],
  );

  const onInstall = async () => {
    const result = await install();
    if (result === "accepted") {
      reportStatus("MolVis installed", "success");
    }
  };

  const onShareLast = async () => {
    const share = readRememberedShareable();
    if (!share) {
      reportStatus(
        "Load a PDB id or public URL first, then share the link",
        "info",
      );
      return;
    }
    const link = buildShareUrl(share);
    const result = await shareOrCopyUrl(
      link,
      share.kind === "pdb" ? share.pdbId : "MolVis structure",
    );
    if (result === "shared") reportStatus("Share sheet opened", "success");
    else if (result === "copied") reportStatus("Share link copied", "success");
    else reportStatus("Could not share or copy the link", "error");
  };

  return (
    <SettingsSection id={sectionId} title="App & sharing">
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {!installed && offer.kind !== "none" && (
            <ViewerAction
              type="button"
              purpose="commit"
              className="gap-1.5"
              onClick={() => void onInstall()}
            >
              <Download className="size-4" aria-hidden />
              {offer.kind === "ios-tip" ? "How to install" : "Install app"}
            </ViewerAction>
          )}
          {installed && (
            <p className="text-label text-status-completed-foreground">
              Running as installed app
            </p>
          )}
          <ViewerAction
            type="button"
            purpose="dismiss"
            className="gap-1.5"
            onClick={() => void onShareLast()}
          >
            <Share2 className="size-4" aria-hidden />
            Share last structure link
          </ViewerAction>
        </div>

        {showIosTip && (
          <p className="rounded-control border border-border/80 bg-panel-raised px-2 py-2 text-label text-muted-foreground">
            Safari → Share → Add to Home Screen. File open stays in-app (Open
            file or a share link).
          </p>
        )}

        {help.map((section) => (
          <div key={section.title} className="space-y-1.5">
            <h3 className="text-body font-medium text-foreground">
              {section.title}
            </h3>
            <ol className="list-decimal space-y-1 pl-4 text-label text-muted-foreground">
              {section.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </div>
        ))}
      </div>
    </SettingsSection>
  );
}
