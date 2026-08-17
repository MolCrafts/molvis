import { clearOpfsCache, readOpfsCacheUsage } from "@molcrafts/molvis-stage";
import { pluginCacheStore } from "@/plugins/contributions/ui";

/**
 * Everything MolVis persists in the browser, grouped for the commands
 * that remove it.
 *
 * The host owns only what it wrote itself. Plugin state is never inferred
 * from key prefixes — a plugin declares what it is willing to lose through
 * `api.caches.register`, and anything it does not declare stays put. That
 * keeps the decision with the code that actually knows whether a key holds
 * a regenerable index or something the user typed.
 */
export type StorageTier =
  /**
   * Cleared by "Clear cache". Host-derived data plus whatever each plugin
   * declared through `api.caches` — a plugin opts its own state in, the
   * host never guesses from key names.
   */
  | "cache"
  /** Preferences and install state — annoying to lose, not irreplaceable. */
  | "config";

export interface StorageGroup {
  id: string;
  label: string;
  tier: StorageTier;
  /** Human-readable count, e.g. "3 files (12.4 MB)" or "2 entries". */
  describe(): Promise<string>;
  clear(): Promise<void>;
}

/** `localStorage` key holding the installed-plugin list. */
const PLUGIN_STORE_KEY = "molvis.plugins.v1";
/** Theme preference. */
const THEME_KEY = "molvis-theme";

function localKeys(match: (key: string) => boolean): string[] {
  if (typeof localStorage === "undefined") return [];
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && match(key)) keys.push(key);
  }
  return keys;
}

function dropKeys(keys: readonly string[]): void {
  if (typeof localStorage === "undefined") return;
  for (const key of keys) localStorage.removeItem(key);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

const HOST_GROUPS: readonly StorageGroup[] = [
  {
    id: "files",
    label: "Cached files",
    tier: "cache",
    async describe() {
      const { files, bytes } = await readOpfsCacheUsage();
      return files === 0
        ? "empty"
        : `${plural(files, "file")} (${formatBytes(bytes)})`;
    },
    async clear() {
      await clearOpfsCache();
    },
  },
  {
    id: "preferences",
    label: "Appearance & settings",
    tier: "config",
    async describe() {
      return localKeys((k) => k === THEME_KEY).length > 0 ? "set" : "default";
    },
    async clear() {
      dropKeys(localKeys((k) => k === THEME_KEY));
    },
  },
  {
    id: "plugins",
    label: "Installed plugins",
    tier: "config",
    async describe() {
      const raw =
        typeof localStorage === "undefined"
          ? null
          : localStorage.getItem(PLUGIN_STORE_KEY);
      if (!raw) return "none";
      try {
        const parsed = JSON.parse(raw) as { entries?: unknown[] };
        return plural(parsed.entries?.length ?? 0, "plugin");
      } catch {
        return "unreadable";
      }
    },
    async clear() {
      dropKeys(localKeys((k) => k === PLUGIN_STORE_KEY));
    },
  },
];

/**
 * Caches the active plugins declared, as storage groups.
 *
 * Read live rather than snapshotted: plugins register on activate and the
 * set changes as the user enables or removes them. Anything a plugin did
 * *not* declare stays untouched — the host has no way to tell a
 * regenerable index from authored content, so it does not try.
 */
function pluginGroups(): StorageGroup[] {
  return pluginCacheStore.list().map((spec) => ({
    id: spec.id,
    label: spec.label,
    tier: "cache" as const,
    async describe() {
      return (await spec.describe?.()) ?? "stored";
    },
    async clear() {
      await spec.clear();
    },
  }));
}

/** Host groups plus everything plugins currently declare. */
export function storageGroups(): StorageGroup[] {
  return [...HOST_GROUPS, ...pluginGroups()];
}

/** Groups that "Clear cache" removes. */
export function cacheGroups(): StorageGroup[] {
  return storageGroups().filter((g) => g.tier === "cache");
}

export function storageGroup(id: string): StorageGroup {
  const group = storageGroups().find((g) => g.id === id);
  if (!group) throw new Error(`Unknown storage group: ${id}`);
  return group;
}

export async function clearGroups(
  groups: readonly StorageGroup[],
): Promise<void> {
  for (const group of groups) {
    await group.clear();
  }
}

/** One-line summary of every group, for a confirmation dialog. */
export async function describeGroups(
  groups: readonly StorageGroup[],
): Promise<Array<{ group: StorageGroup; detail: string }>> {
  return Promise.all(
    groups.map(async (group) => ({ group, detail: await group.describe() })),
  );
}
