/**
 * Client platform detection for open-structure / PWA guidance copy.
 * Pure UA helpers — no React, safe for unit tests.
 */

import { isStandaloneDisplay } from "./pwa";
import { isWeChatBrowser, isWeChatIOS } from "./wechat";

export type ClientPlatform =
  | "wechat-ios"
  | "wechat-android"
  | "ios"
  | "android"
  | "desktop";

export function detectClientPlatform(
  userAgent: string = typeof navigator !== "undefined"
    ? navigator.userAgent
    : "",
): ClientPlatform {
  if (isWeChatIOS(userAgent)) return "wechat-ios";
  if (isWeChatBrowser(userAgent)) return "wechat-android";
  if (/iPhone|iPad|iPod/i.test(userAgent)) return "ios";
  if (/Android/i.test(userAgent)) return "android";
  return "desktop";
}

/** Chromium desktop File Handling (“Open with MolVis”). */
export function supportsFileHandlers(
  platform: ClientPlatform = detectClientPlatform(),
): boolean {
  return platform === "desktop";
}

/** Android Web Share Target (“Share → MolVis”). */
export function supportsShareTarget(
  platform: ClientPlatform = detectClientPlatform(),
): boolean {
  return platform === "android";
}

/**
 * One-line empty-canvas hint for the current platform.
 * Prefer verbs the user can do now; never promise unsupported OS hooks.
 */
export function openStructureHint(
  platform: ClientPlatform = detectClientPlatform(),
): string {
  switch (platform) {
    case "wechat-ios":
      return "微信内请先 ··· → 在 Safari 打开，再用 Open file，或点别人发来的链接。";
    case "wechat-android":
      return "微信内请先 ··· → 在浏览器打开；或点 ?pdb= / 分享链接。装 PWA 后可用「分享到 MolVis」。";
    case "ios":
      return "iOS 请用 Open file 从「文件」选取，或打开别人发来的分享链接。无法「用 App 打开」。";
    case "android":
      return "可 Open file，或安装后从系统「分享」到 MolVis。";
    default:
      return "Open a file, paste a PDB id / URL, or install to use “Open with MolVis”.";
  }
}

export interface OpenHelpSection {
  title: string;
  steps: string[];
}

/** Longer how-to for Settings → App & sharing. */
export function openStructureHelp(
  platform: ClientPlatform = detectClientPlatform(),
  standalone: boolean = isStandaloneDisplay(),
): OpenHelpSection[] {
  const sections: OpenHelpSection[] = [];

  sections.push({
    title: "Share a link (any device)",
    steps: [
      "Use Link / PDB and enter a 4-character RCSB id (e.g. 1CRN) or a public file URL.",
      "Tap Copy link or Share — MolVis builds ?pdb= / ?url= for you.",
      "Local-only files cannot become a link unless you host them somewhere with CORS.",
    ],
  });

  switch (platform) {
    case "wechat-ios":
    case "wechat-android":
      sections.push({
        title: "WeChat chat attachment",
        steps: [
          "WeChat cannot hand a .pdb to MolVis or any PWA.",
          "Best: send a share link (?pdb= or ?url=) instead of the raw file.",
          "Or save the file → ··· → Open in browser/Safari → Open file in MolVis.",
        ],
      });
      break;
    case "ios":
      sections.push({
        title: "iOS",
        steps: [
          standalone
            ? "This Home Screen app cannot register as a system file handler."
            : "Optional: Safari Share → Add to Home Screen for a full-screen icon.",
          "To open a file: save it in Files → open MolVis → Open file.",
          "There is no “Open with MolVis” and no “Share to MolVis” on iOS PWAs.",
        ],
      });
      break;
    case "android":
      sections.push({
        title: "Android",
        steps: [
          standalone
            ? "Installed: use the system Share sheet → MolVis for .pdb / .cif / …"
            : "Install this site as an app (Chrome menu → Install / Add to Home screen).",
          "After install, share a file from Downloads or Files into MolVis.",
          "“Open with” for PWAs is unreliable on Android; prefer Share.",
        ],
      });
      break;
    default:
      sections.push({
        title: "Desktop (Chrome / Edge)",
        steps: [
          standalone
            ? "Installed: right-click a .pdb → Open with → MolVis (File Handling)."
            : "Install from the address bar, then reopen the app once so the OS registers types.",
          "Drag-and-drop onto the canvas always works in the browser tab.",
        ],
      });
  }

  return sections;
}

/** iOS Safari “Add to Home Screen” tip (no beforeinstallprompt). */
export function iosAddToHomeHint(): string {
  return "Safari: tap Share → Add to Home Screen. This does not enable Open with / Share to.";
}
