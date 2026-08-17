/**
 * WeChat (微信) in-app browser detection and open guidance.
 *
 * WeChat's X5/WKWebView does not expose OS file-handler or share-target
 * integration. Chat attachments open WeChat's own preview — they cannot
 * hand a `.pdb` straight to an installed PWA. The practical paths are:
 *
 * 1. Open the page in the system browser, then use Open file.
 * 2. On Android after install: Share → MolVis PWA.
 */

/** Match MicroMessenger UA used by WeChat iOS/Android clients. */
export function isWeChatBrowser(
  userAgent: string = typeof navigator !== "undefined"
    ? navigator.userAgent
    : "",
): boolean {
  return /MicroMessenger/i.test(userAgent);
}

/** True when the UA looks like WeChat on iOS (needs different "open" tips). */
export function isWeChatIOS(
  userAgent: string = typeof navigator !== "undefined"
    ? navigator.userAgent
    : "",
): boolean {
  return isWeChatBrowser(userAgent) && /iPhone|iPad|iPod/i.test(userAgent);
}

/**
 * Short user-facing copy for the in-WeChat banner.
 * Chinese first — primary audience for this surface.
 */
export function weChatOpenBrowserHint(
  userAgent: string = typeof navigator !== "undefined"
    ? navigator.userAgent
    : "",
): string {
  if (isWeChatIOS(userAgent)) {
    return "微信内无法打开附件中的结构文件。请 ··· → 在 Safari 打开后用 Open file。";
  }
  return "微信内无法打开附件中的结构文件。请 ··· → 在浏览器打开后选文件。Android 可安装后「分享到 MolVis」。";
}
