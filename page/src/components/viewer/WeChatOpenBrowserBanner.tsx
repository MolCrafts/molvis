import { DismissRegular as X } from "@fluentui/react-icons";
import { IconAction } from "@molcrafts/ui";
import { useState } from "react";
import { isWeChatBrowser, weChatOpenBrowserHint } from "@/lib/wechat";

const DISMISS_KEY = "molvis.wechat-banner.dismissed";

/**
 * In-WeChat guidance strip. Chat attachments cannot hand a PDB to MolVis;
 * deep links and "Open in browser" are the workable paths.
 */
export function WeChatOpenBrowserBanner(): React.ReactElement | null {
  const [dismissed, setDismissed] = useState(() => {
    if (typeof sessionStorage === "undefined") return false;
    try {
      return sessionStorage.getItem(DISMISS_KEY) === "1";
    } catch {
      return false;
    }
  });

  if (dismissed || !isWeChatBrowser()) return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      sessionStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // private mode
    }
  };

  return (
    <div
      role="status"
      className="flex shrink-0 items-start gap-2 border-b border-status-warning/40 bg-status-warning-soft px-3 py-2 text-label text-status-warning-foreground safe-area-x"
    >
      <p className="min-w-0 flex-1 leading-snug">{weChatOpenBrowserHint()}</p>
      <IconAction
        icon={<X />}
        label="Dismiss"
        onClick={dismiss}
        className="-mr-1 -mt-0.5 text-status-warning-foreground/80"
      />
    </div>
  );
}
