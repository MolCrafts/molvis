/**
 * Fixed strings the plugin host resolves against.
 *
 * These were previously re-typed at each use — the manifest filename at five
 * sites in `resolve.ts`, the log tag at seven across four files — so a typo
 * broke exactly one code path and nothing else noticed.
 */

/** Repo-root manifest every plugin package must publish. */
export const MANIFEST_FILENAME = "molvis.plugin.json";

/**
 * jsDelivr GitHub CDN — **source-tree only** (no Release assets).
 * Used as a last-resort fallback when a tag has no published release package.
 * Prefer {@link githubReleaseDownloadBase}.
 */
export const JSDELIVR_GH_BASE = "https://cdn.jsdelivr.net/gh";

/** GitHub REST API root, used to resolve the latest release tag. */
export const GITHUB_API_BASE = "https://api.github.com";

/** Host used to recognise a GitHub source URL (compared by hostname). */
export const GITHUB_HOST = "github.com";

/**
 * Base URL for flat plugin assets attached to a GitHub Release.
 * Relative entry paths resolve next to this prefix, e.g.
 * `…/releases/download/v1.0.0/plugin.js` + `./worker.js` → sibling asset.
 */
export function githubReleaseDownloadBase(
  owner: string,
  repo: string,
  tag: string,
): string {
  return `https://github.com/${owner}/${repo}/releases/download/${encodeURIComponent(tag)}/`;
}

/** Prefix for host-side console output. */
export const HOST_LOG_TAG = "[molvis-plugins]";
