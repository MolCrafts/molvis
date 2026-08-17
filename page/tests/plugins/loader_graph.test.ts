import { describe, expect, it } from "@rstest/core";
import { rewriteModuleGraph } from "../../src/plugins/loader";

describe("plugin multi-chunk loader", () => {
  it('rewrites minified bare host imports (from"pkg" with no space)', async () => {
    // Production plugin builds minify to `from"react-dom/client"` — the loader
    // must rewrite those, not only spaced `from "…"`.
    const entry = "https://cdn.example.com/min/plugin.js";
    const sources = new Map<string, string>([
      [
        entry,
        `import{createRoot as e}from"react-dom/client";import{useState as t}from"react";export default{id:"t",activate(){}};`,
      ],
    ]);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      // blob: reads must use the real fetch / Response path.
      if (url.startsWith("blob:")) return originalFetch(input as RequestInfo);
      const body = sources.get(url);
      if (!body) return new Response("missing", { status: 404 });
      return new Response(body, {
        status: 200,
        headers: { "Content-Type": "text/javascript" },
      });
    }) as typeof fetch;

    try {
      const blobUrl = await rewriteModuleGraph(entry);
      expect(blobUrl.startsWith("blob:")).toBe(true);
      const text = await (await originalFetch(blobUrl)).text();
      // Bare specs rewritten to host blob modules.
      expect(text).toMatch(/from"blob:/);
      expect(text).not.toMatch(/from["']react-dom\/client["']/);
      expect(text).not.toMatch(/from["']react["']/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("rewriteModuleGraph rewrites relative imports and caches entry", async () => {
    const sources = new Map<string, string>([
      [
        "https://cdn.example.com/pkg/dist/plugin.js",
        `import { helper } from "./helper.js";
export default { id: "t", activate() { return helper(); } };`,
      ],
      [
        "https://cdn.example.com/pkg/dist/helper.js",
        `export function helper() { return 42; }`,
      ],
    ]);
    const fetched: string[] = [];

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      fetched.push(url);
      const body = sources.get(url);
      if (!body) {
        return new Response(`missing ${url}`, { status: 404 });
      }
      return new Response(body, {
        status: 200,
        headers: { "Content-Type": "text/javascript" },
      });
    }) as typeof fetch;

    try {
      const blobUrl = await rewriteModuleGraph(
        "https://cdn.example.com/pkg/dist/plugin.js",
      );
      expect(blobUrl.startsWith("blob:")).toBe(true);
      // Entry + one relative chunk.
      expect(fetched).toContain("https://cdn.example.com/pkg/dist/plugin.js");
      expect(fetched).toContain("https://cdn.example.com/pkg/dist/helper.js");

      // Second call is cache-hit (no extra network for entry).
      const n = fetched.length;
      const again = await rewriteModuleGraph(
        "https://cdn.example.com/pkg/dist/plugin.js",
      );
      expect(again).toBe(blobUrl);
      expect(fetched.length).toBe(n);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
