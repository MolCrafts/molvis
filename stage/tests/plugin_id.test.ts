import { describe, expect, it } from "@rstest/core";
import {
  isNamespacedPluginId,
  namespacePluginId,
  PLUGIN_ID_PREFIX,
  pluginIdLeaf,
} from "../src/plugin_id";

describe("namespacePluginId", () => {
  it("prefixes a plain local id with the plugin id", () => {
    expect(namespacePluginId("com.example", "wizard")).toBe(
      "plugin.com.example.wizard",
    );
  });

  it("still prefixes dotted local ids", () => {
    // Regression: treating any dot as "already namespaced" meant two plugins
    // registering `settings.about` or `io.load` collided on one id.
    expect(namespacePluginId("com.a", "settings.about")).toBe(
      "plugin.com.a.settings.about",
    );
    expect(namespacePluginId("com.b", "settings.about")).toBe(
      "plugin.com.b.settings.about",
    );
    expect(namespacePluginId("com.a", "settings.about")).not.toBe(
      namespacePluginId("com.b", "settings.about"),
    );
  });

  it("is idempotent for an already-namespaced id", () => {
    const once = namespacePluginId("com.example", "python");
    expect(namespacePluginId("com.example", once)).toBe(once);
    expect(isNamespacedPluginId(once)).toBe(true);
    expect(once.startsWith(PLUGIN_ID_PREFIX)).toBe(true);
  });
});

describe("pluginIdLeaf", () => {
  it("returns the last segment of a namespaced id", () => {
    expect(pluginIdLeaf("plugin.com.example.python")).toBe("python");
  });

  it("passes a built-in mode id through unchanged", () => {
    expect(pluginIdLeaf("view")).toBe("view");
  });

  it("falls back to the whole id when it ends in a separator", () => {
    expect(pluginIdLeaf("plugin.com.example.")).toBe("plugin.com.example.");
  });
});
