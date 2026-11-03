/**
 * Host-side plugin types.
 *
 * Plugin-facing contract is public `@molcrafts/molvis/plugin` (re-exported
 * from `./contract`). This file adds host-only install/runtime chrome.
 */

import type { Molvis } from "@molcrafts/molvis-plugin";
import type React from "react";

export * from "@molcrafts/molvis-plugin";

/**
 * Host-internal command-palette entry. Plugins never construct this — they
 * pass `CommandToolbarOptions` to `commands.register` and the host derives
 * the action from it.
 */
export interface ToolbarActionSpec {
  id: string;
  label: string;
  icon?: React.ReactNode;
  order?: number;
  onClick: (app: Molvis) => void;
  isVisible?: (app: Molvis) => boolean;
  /**
   * When set, the command palette must not also list this dialog —
   * the toolbar entry is the single discovery surface.
   */
  opensDialog?: string;
}

/** Persisted install record. */
export interface PluginInstallRecord {
  source: string;
  enabled: boolean;
  id?: string;
  installedAt: string;
}

export interface PluginStoreV1 {
  version: 1;
  entries: PluginInstallRecord[];
}

export type PluginRuntimeStatus =
  | "idle"
  | "loading"
  | "active"
  | "disabled"
  | "error";

export interface PluginRuntimeState {
  source: string;
  enabled: boolean;
  id?: string;
  name?: string;
  version?: string;
  status: PluginRuntimeStatus;
  error?: string;
  installedAt: string;
  /**
   * Git ref this install is pinned to, when one was resolved. Absent means
   * the plugin rides the default-branch tip and can change under the user.
   */
  resolvedRef?: string;
}

/**
 * How package assets are laid out under {@link ResolvedPluginSource.baseUrl}.
 *
 * - `release` — flat GitHub Release assets (`plugin.js` next to manifest)
 * - `tree` — source-tree CDN (jsDelivr); entry often still `dist/plugin.js`
 * - `direct` — user-supplied HTTP base (local serve, custom CDN)
 */
export type PluginPackageLayout = "release" | "tree" | "direct";

/** Resolved URLs for loading a plugin package. */
export interface ResolvedPluginSource {
  /**
   * Canonical key stored in localStorage / Settings list.
   * GitHub sources always use short form `owner/repo` or `owner/repo@ref`
   * — never a release-download or jsDelivr URL.
   */
  sourceKey: string;
  /** Base URL ending with `/` for resolving relative entry paths. */
  baseUrl: string;
  manifestUrl: string;
  /** Asset layout under baseUrl (drives entry path normalization). */
  layout: PluginPackageLayout;
  /**
   * Git ref actually used for CDN (tag/branch/sha). Set when the user
   * omitted `@ref` and we pinned to the latest GitHub release, or when
   * they supplied one. Absent for unpinned default-branch / direct URLs.
   */
  resolvedRef?: string;
}
