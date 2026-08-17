/**
 * Progressive Web App helpers for the standalone page host.
 *
 * Registration is gated: only the top-level `#root` host (not Jupyter /
 * VSCode embeds) should call {@link registerMolvisServiceWorker}.
 */

/** True when running as an installed PWA (standalone display mode). */
export function isStandaloneDisplay(): boolean {
  if (typeof window === "undefined") return false;
  const mq = window.matchMedia?.("(display-mode: standalone)");
  if (mq?.matches) return true;
  // iOS Safari legacy signal
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true;
}

/**
 * Register the MolVis service worker when the browser supports it and we
 * are on a secure origin. Resolves to the registration or null.
 */
export async function registerMolvisServiceWorker(
  swUrl = "./sw.js",
): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === "undefined") return null;
  if (!("serviceWorker" in navigator)) return null;
  // File protocol / insecure origins cannot register.
  if (
    window.location.protocol !== "https:" &&
    window.location.hostname !== "localhost" &&
    window.location.hostname !== "127.0.0.1"
  ) {
    return null;
  }

  try {
    const reg = await navigator.serviceWorker.register(swUrl, {
      scope: "./",
      updateViaCache: "none",
    });
    // Nudge updates so a tab refresh picks up a new SW quickly.
    void reg.update();
    return reg;
  } catch (err) {
    console.warn("[molvis] service worker registration failed", err);
    return null;
  }
}

export interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/**
 * Listen for the Chromium install prompt. Returns an unsubscribe function.
 * Callers hold the event and call `prompt()` from a user gesture.
 */
export function onBeforeInstallPrompt(
  handler: (event: BeforeInstallPromptEvent) => void,
): () => void {
  if (typeof window === "undefined") return () => {};
  const listener = (e: Event) => {
    e.preventDefault();
    handler(e as BeforeInstallPromptEvent);
  };
  window.addEventListener("beforeinstallprompt", listener);
  return () => window.removeEventListener("beforeinstallprompt", listener);
}

/** True on iPhone / iPad / iPod (including iPadOS desktop UA with touch). */
export function isAppleTouchDevice(
  userAgent: string = typeof navigator !== "undefined"
    ? navigator.userAgent
    : "",
): boolean {
  if (/iPhone|iPad|iPod/i.test(userAgent)) return true;
  // iPadOS 13+ can report as Macintosh + touch.
  if (
    typeof navigator !== "undefined" &&
    /Macintosh/i.test(userAgent) &&
    navigator.maxTouchPoints > 1
  ) {
    return true;
  }
  return false;
}

/**
 * Fire the deferred install prompt when we still have one.
 * Returns the user outcome, or null if nothing to show.
 */
export async function promptInstall(
  event: BeforeInstallPromptEvent | null,
): Promise<"accepted" | "dismissed" | null> {
  if (!event) return null;
  try {
    await event.prompt();
    const { outcome } = await event.userChoice;
    return outcome;
  } catch {
    return null;
  }
}
