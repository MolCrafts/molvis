import { describe, expect, it } from "@rstest/core";
import {
  canonicalizePluginSourceKey,
  fetchLatestGithubReleaseTag,
  looksLikeReleaseTag,
  resolvePluginSource,
} from "../../src/plugins/resolve";

function mockFetch(
  impl: (
    url: string,
  ) => Promise<{ ok: boolean; body: unknown; status?: number }>,
): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    const { ok, body, status } = await impl(url);
    return {
      ok,
      status: status ?? (ok ? 200 : 404),
      json: async () => body,
    } as Response;
  }) as typeof fetch;
}

describe("looksLikeReleaseTag", () => {
  it("accepts semver-like tags", () => {
    expect(looksLikeReleaseTag("v0.4.0")).toBe(true);
    expect(looksLikeReleaseTag("1.2.3")).toBe(true);
    expect(looksLikeReleaseTag("v1.0.0-beta.1")).toBe(true);
  });

  it("rejects branch-like refs", () => {
    expect(looksLikeReleaseTag("master")).toBe(false);
    expect(looksLikeReleaseTag("release/v0.2.0")).toBe(false);
  });
});

describe("canonicalizePluginSourceKey", () => {
  it("keeps short GitHub form and collapses github.com URLs", () => {
    expect(canonicalizePluginSourceKey("  alice/hello  ")).toBe("alice/hello");
    expect(canonicalizePluginSourceKey("alice/hello@v1.0.0")).toBe(
      "alice/hello@v1.0.0",
    );
    expect(
      canonicalizePluginSourceKey("https://github.com/alice/hello/tree/v1.0.0"),
    ).toBe("alice/hello@v1.0.0");
    expect(
      canonicalizePluginSourceKey(
        "https://github.com/alice/hello/releases/download/v1.0.0/plugin.js",
      ),
    ).toBe("alice/hello@v1.0.0");
  });

  it("leaves direct HTTP bases unchanged", () => {
    expect(canonicalizePluginSourceKey("http://127.0.0.1:4173/")).toBe(
      "http://127.0.0.1:4173/",
    );
  });
});

describe("resolvePluginSource", () => {
  it("owner/repo without tag pins to latest GitHub *Release assets*", async () => {
    const r = await resolvePluginSource("alice/hello-plugin", {
      fetchImpl: mockFetch(async () => ({
        ok: true,
        body: { tag_name: "v3.1.0" },
      })),
    });
    expect(r.sourceKey).toBe("alice/hello-plugin");
    expect(r.layout).toBe("release");
    expect(r.baseUrl).toBe(
      "https://github.com/alice/hello-plugin/releases/download/v3.1.0/",
    );
    expect(r.manifestUrl).toBe(
      "https://github.com/alice/hello-plugin/releases/download/v3.1.0/molvis.plugin.json",
    );
    expect(r.resolvedRef).toBe("v3.1.0");
  });

  it("owner/repo without tag falls back to default-branch tip when no release", async () => {
    const r = await resolvePluginSource("alice/hello-plugin", {
      fetchImpl: mockFetch(async () => ({ ok: false, status: 404, body: {} })),
    });
    expect(r.sourceKey).toBe("alice/hello-plugin");
    expect(r.layout).toBe("tree");
    expect(r.baseUrl).toBe("https://cdn.jsdelivr.net/gh/alice/hello-plugin/");
    expect(r.resolvedRef).toBeUndefined();
  });

  it("resolves owner/repo@tag to Release download base (no API)", async () => {
    let called = false;
    const r = await resolvePluginSource("alice/hello-plugin@v1.2.3", {
      fetchImpl: mockFetch(async () => {
        called = true;
        return { ok: true, body: { tag_name: "v9.9.9" } };
      }),
    });
    expect(r.sourceKey).toBe("alice/hello-plugin@v1.2.3");
    expect(r.layout).toBe("release");
    expect(r.baseUrl).toBe(
      "https://github.com/alice/hello-plugin/releases/download/v1.2.3/",
    );
    expect(r.resolvedRef).toBe("v1.2.3");
    expect(called).toBe(false);
  });

  it("resolves github.com tree URL of a release tag to short key + Release assets", async () => {
    const r = await resolvePluginSource(
      "https://github.com/alice/hello-plugin/tree/v2.0.0",
    );
    expect(r.sourceKey).toBe("alice/hello-plugin@v2.0.0");
    expect(r.layout).toBe("release");
    expect(r.baseUrl).toBe(
      "https://github.com/alice/hello-plugin/releases/download/v2.0.0/",
    );
    expect(r.resolvedRef).toBe("v2.0.0");
  });

  it("canonicalizes pasted Release asset URLs to owner/repo@tag", async () => {
    const r = await resolvePluginSource(
      "https://github.com/alice/hello-plugin/releases/download/v1.0.0/molvis.plugin.json",
    );
    expect(r.sourceKey).toBe("alice/hello-plugin@v1.0.0");
    expect(r.layout).toBe("release");
    expect(r.baseUrl).toBe(
      "https://github.com/alice/hello-plugin/releases/download/v1.0.0/",
    );
  });

  it("resolves non-semver ref via jsDelivr git tree", async () => {
    const r = await resolvePluginSource("alice/hello-plugin@feature-x");
    expect(r.sourceKey).toBe("alice/hello-plugin@feature-x");
    expect(r.layout).toBe("tree");
    expect(r.baseUrl).toBe(
      "https://cdn.jsdelivr.net/gh/alice/hello-plugin@feature-x/",
    );
  });

  it("resolves direct manifest URL", async () => {
    const r = await resolvePluginSource(
      "https://cdn.example.com/pkg/molvis.plugin.json",
    );
    expect(r.layout).toBe("direct");
    expect(r.baseUrl).toBe("https://cdn.example.com/pkg/");
    expect(r.manifestUrl).toBe(
      "https://cdn.example.com/pkg/molvis.plugin.json",
    );
  });

  it("rejects empty input", async () => {
    await expect(resolvePluginSource("  ")).rejects.toThrow(/empty/i);
  });

  it("resolves local HTTP base URL for debug serving", async () => {
    const r = await resolvePluginSource("http://127.0.0.1:4173/");
    expect(r.layout).toBe("direct");
    expect(r.baseUrl).toBe("http://127.0.0.1:4173/");
    expect(r.manifestUrl).toBe("http://127.0.0.1:4173/molvis.plugin.json");
  });

  it("resolves local HTTP entry URL", async () => {
    const r = await resolvePluginSource("http://localhost:4174/dist/plugin.js");
    expect(r.layout).toBe("direct");
    expect(r.baseUrl).toBe("http://localhost:4174/dist/");
    expect(r.manifestUrl).toBe("http://localhost:4174/dist/molvis.plugin.json");
  });

  it("rejects file:// and bare filesystem paths", async () => {
    await expect(
      resolvePluginSource("file:///Users/me/plugin/dist/plugin.js"),
    ).rejects.toThrow(/filesystem|HTTP/i);
    await expect(resolvePluginSource("/Users/me/plugin")).rejects.toThrow(
      /filesystem|HTTP/i,
    );
  });
});

describe("fetchLatestGithubReleaseTag", () => {
  it("returns tag_name on success", async () => {
    const tag = await fetchLatestGithubReleaseTag(
      "o",
      "r",
      mockFetch(async () => ({
        ok: true,
        body: { tag_name: "v0.2.0" },
      })),
    );
    expect(tag).toBe("v0.2.0");
  });

  it("returns null on network failure", async () => {
    const tag = await fetchLatestGithubReleaseTag("o", "r", (async () => {
      throw new Error("offline");
    }) as typeof fetch);
    expect(tag).toBeNull();
  });
});
