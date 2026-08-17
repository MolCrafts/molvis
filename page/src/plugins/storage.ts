import type { PluginInstallRecord, PluginStoreV1 } from "./types";

const STORAGE_KEY = "molvis.plugins.v1";

export function loadPluginStore(): PluginStoreV1 {
  if (typeof localStorage === "undefined") {
    return { version: 1, entries: [] };
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { version: 1, entries: [] };
    const parsed = JSON.parse(raw) as PluginStoreV1;
    if (parsed?.version !== 1 || !Array.isArray(parsed.entries)) {
      return { version: 1, entries: [] };
    }
    return {
      version: 1,
      entries: parsed.entries.filter(
        (e): e is PluginInstallRecord =>
          !!e &&
          typeof e.source === "string" &&
          typeof e.enabled === "boolean" &&
          typeof e.installedAt === "string",
      ),
    };
  } catch {
    return { version: 1, entries: [] };
  }
}

export function savePluginStore(store: PluginStoreV1): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

export function upsertInstallRecord(record: PluginInstallRecord): void {
  const store = loadPluginStore();
  const idx = store.entries.findIndex((e) => e.source === record.source);
  if (idx >= 0) {
    store.entries[idx] = { ...store.entries[idx], ...record };
  } else {
    store.entries.push(record);
  }
  savePluginStore(store);
}

export function removeInstallRecord(source: string): void {
  const store = loadPluginStore();
  store.entries = store.entries.filter((e) => e.source !== source);
  savePluginStore(store);
}

export function setInstallEnabled(source: string, enabled: boolean): void {
  const store = loadPluginStore();
  const entry = store.entries.find((e) => e.source === source);
  if (!entry) return;
  entry.enabled = enabled;
  savePluginStore(store);
}

export function pluginStorageNamespace(pluginId: string) {
  const prefix = `molvis.plugin.${pluginId}.`;
  return {
    getItem(key: string): string | null {
      if (typeof localStorage === "undefined") return null;
      return localStorage.getItem(prefix + key);
    },
    setItem(key: string, value: string): void {
      if (typeof localStorage === "undefined") return;
      localStorage.setItem(prefix + key, value);
    },
    removeItem(key: string): void {
      if (typeof localStorage === "undefined") return;
      localStorage.removeItem(prefix + key);
    },
  };
}
