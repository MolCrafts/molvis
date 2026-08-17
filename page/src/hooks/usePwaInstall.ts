import { useCallback, useEffect, useState } from "react";
import {
  type BeforeInstallPromptEvent,
  isAppleTouchDevice,
  isStandaloneDisplay,
  onBeforeInstallPrompt,
  promptInstall,
} from "@/lib/pwa";

export type InstallOffer =
  | { kind: "chromium"; event: BeforeInstallPromptEvent }
  | { kind: "ios-tip" }
  | { kind: "none" };

/**
 * Track whether we can offer install UI (Chromium prompt or iOS Home Screen tip).
 */
export function usePwaInstall(): {
  offer: InstallOffer;
  installed: boolean;
  install: () => Promise<"accepted" | "dismissed" | "ios-tip" | null>;
  dismissIosTip: () => void;
  showIosTip: boolean;
} {
  const [installed, setInstalled] = useState(() => isStandaloneDisplay());
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(
    null,
  );
  const [showIosTip, setShowIosTip] = useState(false);

  useEffect(() => {
    setInstalled(isStandaloneDisplay());
    const unsub = onBeforeInstallPrompt((event) => {
      setDeferred(event);
    });
    const onInstalled = () => {
      setInstalled(true);
      setDeferred(null);
    };
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      unsub();
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const offer: InstallOffer = installed
    ? { kind: "none" }
    : deferred
      ? { kind: "chromium", event: deferred }
      : isAppleTouchDevice()
        ? { kind: "ios-tip" }
        : { kind: "none" };

  const install = useCallback(async () => {
    if (installed) return null;
    if (deferred) {
      const outcome = await promptInstall(deferred);
      if (outcome === "accepted") {
        setDeferred(null);
        setInstalled(true);
      }
      // Chromium invalidates the event after one prompt attempt.
      setDeferred(null);
      return outcome;
    }
    if (isAppleTouchDevice()) {
      setShowIosTip(true);
      return "ios-tip";
    }
    return null;
  }, [deferred, installed]);

  return {
    offer,
    installed,
    install,
    dismissIosTip: () => setShowIosTip(false),
    showIosTip,
  };
}
