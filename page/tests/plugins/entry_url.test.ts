import { describe, expect, it } from "@rstest/core";
import {
  normalizeManifestEntry,
  resolvePluginEntryUrl,
} from "../../src/plugins/resolve";

const TREE_BASE = "https://cdn.jsdelivr.net/gh/owner/repo@v1.0.0/";
const RELEASE_BASE = "https://github.com/owner/repo/releases/download/v1.0.0/";

describe("normalizeManifestEntry", () => {
  it("strips dist/ only on release layout", () => {
    expect(normalizeManifestEntry("dist/plugin.js", "release")).toBe(
      "plugin.js",
    );
    expect(normalizeManifestEntry("./dist/plugin.js", "release")).toBe(
      "plugin.js",
    );
    expect(normalizeManifestEntry("plugin.js", "release")).toBe("plugin.js");
    expect(normalizeManifestEntry("dist/plugin.js", "tree")).toBe(
      "dist/plugin.js",
    );
    expect(normalizeManifestEntry("dist/plugin.js", "direct")).toBe(
      "dist/plugin.js",
    );
  });
});

describe("resolvePluginEntryUrl", () => {
  it("resolves a relative entry against the package base (tree)", () => {
    expect(resolvePluginEntryUrl("dist/plugin.js", TREE_BASE)).toBe(
      `${TREE_BASE}dist/plugin.js`,
    );
    expect(resolvePluginEntryUrl("./dist/plugin.js", TREE_BASE)).toBe(
      `${TREE_BASE}dist/plugin.js`,
    );
  });

  it("on release layout maps dist/plugin.js → flat plugin.js", () => {
    expect(
      resolvePluginEntryUrl("dist/plugin.js", RELEASE_BASE, {
        layout: "release",
      }),
    ).toBe(`${RELEASE_BASE}plugin.js`);
    expect(
      resolvePluginEntryUrl("plugin.js", RELEASE_BASE, { layout: "release" }),
    ).toBe(`${RELEASE_BASE}plugin.js`);
  });

  it("rejects an absolute entry URL", () => {
    // `new URL(entry, base)` drops the base entirely for an absolute entry,
    // so an unchecked manifest could run code from any origin.
    expect(() =>
      resolvePluginEntryUrl("https://attacker.example/payload.js", TREE_BASE),
    ).toThrow(/relative path/);
    expect(() =>
      resolvePluginEntryUrl("//attacker.example/x.js", TREE_BASE),
    ).toThrow(/relative path/);
  });

  it("rejects traversal out of the package root", () => {
    expect(() =>
      resolvePluginEntryUrl("../../other-repo/plugin.js", TREE_BASE),
    ).toThrow(/escapes its package root/);
  });

  it("rejects an empty entry", () => {
    expect(() => resolvePluginEntryUrl("   ", TREE_BASE)).toThrow(/empty/);
  });
});
