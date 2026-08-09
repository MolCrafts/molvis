import { afterEach, describe, expect, it } from "@rstest/core";
import {
  buildShareUrl,
  filenameFromUrl,
  normalizePdbId,
  parseStructureSourceFromParams,
  rcsbPdbUrl,
  resolveOpenInput,
  stripStructureParamsFromLocation,
} from "../../src/lib/open-structure";
import {
  detectClientPlatform,
  openStructureHint,
  supportsFileHandlers,
  supportsShareTarget,
} from "../../src/lib/platform";
import {
  isWeChatBrowser,
  isWeChatIOS,
  weChatOpenBrowserHint,
} from "../../src/lib/wechat";

describe("normalizePdbId", () => {
  it("accepts classic 4-char accessions", () => {
    expect(normalizePdbId("1crn")).toBe("1CRN");
    expect(normalizePdbId(" 4HHB ")).toBe("4HHB");
  });

  it("rejects non-ids", () => {
    expect(normalizePdbId("")).toBeNull();
    expect(normalizePdbId("protein")).toBeNull();
    expect(normalizePdbId("1cr")).toBeNull();
    expect(normalizePdbId("12abc")).toBeNull();
  });
});

describe("rcsbPdbUrl", () => {
  it("builds the download URL", () => {
    expect(rcsbPdbUrl("1crn")).toBe("https://files.rcsb.org/download/1CRN.pdb");
  });
});

describe("filenameFromUrl", () => {
  it("takes the last path segment", () => {
    expect(filenameFromUrl("https://example.com/data/aspirin.sdf?x=1")).toBe(
      "aspirin.sdf",
    );
  });

  it("falls back when the path has no extension", () => {
    expect(filenameFromUrl("https://example.com/download")).toBe(
      "structure.pdb",
    );
  });
});

describe("parseStructureSourceFromParams", () => {
  it("prefers pdb over url", () => {
    const params = new URLSearchParams("pdb=1crn&url=https://x.test/a.pdb");
    expect(parseStructureSourceFromParams(params)).toEqual({
      kind: "pdb",
      filename: "1CRN.pdb",
      url: "https://files.rcsb.org/download/1CRN.pdb",
    });
  });

  it("parses absolute structure URLs", () => {
    const params = new URLSearchParams(
      "url=https://cdn.example/mols/water.xyz",
    );
    expect(parseStructureSourceFromParams(params)).toEqual({
      kind: "url",
      filename: "water.xyz",
      url: "https://cdn.example/mols/water.xyz",
    });
  });

  it("ignores non-http urls", () => {
    const params = new URLSearchParams("url=file:///tmp/a.pdb");
    expect(parseStructureSourceFromParams(params)).toBeNull();
  });

  it("signals shared hand-off", () => {
    expect(
      parseStructureSourceFromParams(new URLSearchParams("shared=1")),
    ).toEqual({ kind: "shared", filename: "shared-structure" });
  });

  it("returns null when empty", () => {
    expect(parseStructureSourceFromParams(new URLSearchParams())).toBeNull();
  });
});

describe("stripStructureParamsFromLocation", () => {
  afterEach(() => {
    // no global pollution
  });

  it("removes open keys and keeps mount opts", () => {
    let replaced = "";
    stripStructureParamsFromLocation(
      "?pdb=1CRN&ws_url=ws://x&theme=dark&shared=1",
      (url) => {
        replaced = url;
      },
    );
    // pathname is empty in node — only query matters for the test double
    expect(replaced.includes("pdb=")).toBe(false);
    expect(replaced.includes("shared=")).toBe(false);
    expect(replaced.includes("ws_url=")).toBe(true);
    expect(replaced.includes("theme=dark")).toBe(true);
  });
});

describe("buildShareUrl / resolveOpenInput", () => {
  it("builds pdb deep links without leftover params", () => {
    const href = buildShareUrl(
      { kind: "pdb", pdbId: "1CRN" },
      "https://molvis.dev/app/?demo=1&url=https://old.test/x.pdb",
    );
    const u = new URL(href);
    expect(u.searchParams.get("pdb")).toBe("1CRN");
    expect(u.searchParams.get("url")).toBeNull();
    expect(u.searchParams.get("demo")).toBe("1");
  });

  it("resolves pdb ids and bare file URLs", () => {
    expect(resolveOpenInput("1crn")).toEqual({
      filename: "1CRN.pdb",
      url: "https://files.rcsb.org/download/1CRN.pdb",
      share: { kind: "pdb", pdbId: "1CRN" },
    });
    expect(resolveOpenInput("https://cdn.example/a.xyz")?.share).toEqual({
      kind: "url",
      url: "https://cdn.example/a.xyz",
    });
  });

  it("resolves a full MolVis share link", () => {
    const resolved = resolveOpenInput(
      "https://molvis.dev/app/?pdb=4hhb&theme=dark",
    );
    expect(resolved?.share).toEqual({ kind: "pdb", pdbId: "4HHB" });
    expect(resolved?.url).toBe("https://files.rcsb.org/download/4HHB.pdb");
  });

  it("rejects junk", () => {
    expect(resolveOpenInput("")).toBeNull();
    expect(resolveOpenInput("not-a-pdb")).toBeNull();
  });
});

describe("platform helpers", () => {
  const ios =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15";
  const android =
    "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120.0.0.0";
  const desktop =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0";

  it("detects platforms", () => {
    expect(detectClientPlatform(ios)).toBe("ios");
    expect(detectClientPlatform(android)).toBe("android");
    expect(detectClientPlatform(desktop)).toBe("desktop");
  });

  it("gates file handlers and share target correctly", () => {
    expect(supportsFileHandlers("desktop")).toBe(true);
    expect(supportsFileHandlers("ios")).toBe(false);
    expect(supportsShareTarget("android")).toBe(true);
    expect(supportsShareTarget("ios")).toBe(false);
  });

  it("mentions iOS limits in the empty-canvas hint", () => {
    expect(openStructureHint("ios")).toMatch(/Open file/i);
    expect(openStructureHint("ios")).not.toMatch(/Open with/i);
  });
});

describe("wechat helpers", () => {
  const wxAndroid =
    "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 MicroMessenger/8.0.0";
  const wxIOS =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) MicroMessenger/8.0.0";
  const chrome =
    "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120.0.0.0";

  it("detects WeChat UA", () => {
    expect(isWeChatBrowser(wxAndroid)).toBe(true);
    expect(isWeChatBrowser(wxIOS)).toBe(true);
    expect(isWeChatBrowser(chrome)).toBe(false);
  });

  it("detects iOS WeChat", () => {
    expect(isWeChatIOS(wxIOS)).toBe(true);
    expect(isWeChatIOS(wxAndroid)).toBe(false);
  });

  it("returns a non-empty open-browser hint", () => {
    expect(weChatOpenBrowserHint(wxAndroid).length).toBeGreaterThan(10);
    expect(weChatOpenBrowserHint(wxIOS)).toMatch(/Safari/);
  });
});
