import { describe, expect, it } from "@rstest/core";
import {
  cacheGroups,
  clearGroups,
  formatBytes,
  storageGroup,
  storageGroups,
} from "@/lib/molvis-storage";
import { registerPluginCache } from "@/plugins/contributions/ui";

const KEYS = {
  theme: "molvis-theme",
  plugins: "molvis.plugins.v1",
  notebook: "molvis.plugin.com.molcrafts.pyodide-molpy.notebook.v1",
  scripts: "molvis.plugin.com.molcrafts.pyodide-molpy.scripts.v1",
  unrelated: "some-other-app.setting",
};

function seed(): void {
  localStorage.clear();
  localStorage.setItem(KEYS.theme, "dark");
  localStorage.setItem(
    KEYS.plugins,
    JSON.stringify({ version: 1, entries: [{ source: "a" }, { source: "b" }] }),
  );
  localStorage.setItem(KEYS.notebook, '{"cells":[]}');
  localStorage.setItem(KEYS.scripts, '{"scripts":[]}');
  localStorage.setItem(KEYS.unrelated, "keep me");
}

describe("formatBytes", () => {
  it("scales into readable units", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(20 * 1024 * 1024)).toBe("20 MB");
  });
});

describe("storage groups", () => {
  it("separates caches from configuration", () => {
    expect(storageGroup("files").tier).toBe("cache");
    expect(storageGroup("plugins").tier).toBe("config");
    expect(cacheGroups().map((g) => g.id)).toContain("files");
    expect(cacheGroups().map((g) => g.id)).not.toContain("plugins");
  });

  it("never touches plugin storage a plugin did not declare", async () => {
    seed();
    // `molvis.plugin.*` keys exist, but no plugin registered a cache for
    // them — the host must not infer that a prefix means "disposable".
    await clearGroups(cacheGroups());
    expect(localStorage.getItem(KEYS.notebook)).not.toBeNull();
  });

  it("includes caches a plugin declares, and clears through them", async () => {
    seed();
    let cleared = false;
    const dispose = registerPluginCache({
      id: "plugin.test.notebook",
      label: "Test notebook",
      describe: () => "2 cells",
      clear: () => {
        cleared = true;
        localStorage.removeItem(KEYS.notebook);
      },
    });
    try {
      const ids = cacheGroups().map((g) => g.id);
      expect(ids).toContain("plugin.test.notebook");
      expect(await storageGroup("plugin.test.notebook").describe()).toBe(
        "2 cells",
      );

      await clearGroups(cacheGroups());
      expect(cleared).toBe(true);
      expect(localStorage.getItem(KEYS.notebook)).toBeNull();
      // Declaring a cache must not widen the blast radius.
      expect(localStorage.getItem(KEYS.plugins)).not.toBeNull();
    } finally {
      dispose();
    }
  });

  it("drops a plugin's caches once it unregisters", () => {
    const dispose = registerPluginCache({
      id: "plugin.test.gone",
      label: "Gone",
      clear: () => {},
    });
    expect(cacheGroups().map((g) => g.id)).toContain("plugin.test.gone");
    dispose();
    expect(cacheGroups().map((g) => g.id)).not.toContain("plugin.test.gone");
  });
});

describe("clearing a group", () => {
  it("removes only that group's keys", async () => {
    seed();
    await clearGroups([storageGroup("preferences")]);
    expect(localStorage.getItem(KEYS.theme)).toBeNull();
    expect(localStorage.getItem(KEYS.plugins)).not.toBeNull();
    expect(localStorage.getItem(KEYS.notebook)).not.toBeNull();
  });

  it("never touches storage owned by the host page", async () => {
    seed();
    await clearGroups(storageGroups());
    // MolVis is usually embedded; wiping the whole origin would take the
    // host's data with it.
    expect(localStorage.getItem(KEYS.unrelated)).toBe("keep me");
  });

  it("describes what each group holds", async () => {
    seed();
    expect(await storageGroup("plugins").describe()).toBe("2 plugins");
    expect(await storageGroup("preferences").describe()).toBe("set");
    await clearGroups([storageGroup("preferences")]);
    expect(await storageGroup("preferences").describe()).toBe("default");
  });
});
