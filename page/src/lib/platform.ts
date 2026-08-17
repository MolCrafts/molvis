/**
 * Client platform detection for open-structure / PWA guidance copy.
 * Pure UA helpers — no React, safe for unit tests.
 */

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
      return "微信内请先 ··· → 在 Safari 打开，再用 Open file。";
    case "wechat-android":
      return "微信内请先 ··· → 在浏览器打开。装 PWA 后可用「分享到 MolVis」。";
    case "ios":
      return "iOS 请用 Open file 从「文件」选取。无法「用 App 打开」。";
    case "android":
      return "可 Open file，或安装后从系统「分享」到 MolVis。";
    default:
      return "Open a file, paste a PDB id / URL, or install to use “Open with MolVis”.";
  }
}

/** iOS Safari “Add to Home Screen” tip (no beforeinstallprompt). */
export function iosAddToHomeHint(): string {
  return "Safari: tap Share → Add to Home Screen.";
}
