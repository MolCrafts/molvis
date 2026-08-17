import { describe, expect, it } from "@rstest/core";
import type { MolvisApp } from "../../../src/app";
import type { CategoricalThemeId } from "../../../src/artist/style_manager";
import { RPCRouter } from "../../../src/transport/rpc/router";

function request(method: string, params: Record<string, unknown>) {
  return { jsonrpc: "2.0" as const, id: 1, method, params };
}

function mockThemeApp() {
  const themes: CategoricalThemeId[] = [];
  let recolor = 0;
  let renders = 0;
  const themesPassedToSetTheme: unknown[] = [];

  const app = {
    frame: undefined,
    styleManager: {
      setCategoricalTheme: (id: CategoricalThemeId) => {
        themes.push(id);
      },
      setTheme: (theme: unknown) => {
        themesPassedToSetTheme.push(theme);
      },
    },
    artist: {
      recolorFromTheme: () => {
        recolor += 1;
      },
    },
    applyPipeline: async () => null,
    world: {
      renderOnce: () => {
        renders += 1;
      },
    },
  } as unknown as MolvisApp;

  return {
    app,
    themes,
    get recolor() {
      return recolor;
    },
    get renders() {
      return renders;
    },
    themesPassedToSetTheme,
  };
}

describe("TestHandleSetTheme", () => {
  it("accepts tab10 and ovito", async () => {
    const mock = mockThemeApp();
    const router = new RPCRouter(mock.app);

    const tab10 = await router.execute(
      request("view.set_theme", { theme: "tab10" }),
    );
    expect(tab10.content.error).toBeUndefined();
    expect(tab10.content.result).toEqual({ success: true, theme: "tab10" });

    const ovito = await router.execute(
      request("view.set_theme", { theme: "OVITO" }),
    );
    expect(ovito.content.error).toBeUndefined();
    expect(ovito.content.result).toEqual({ success: true, theme: "ovito" });

    expect(mock.themes).toEqual(["tab10", "ovito"]);
    expect(mock.recolor).toBe(2);
    expect(mock.renders).toBe(2);
    expect(mock.themesPassedToSetTheme).toEqual([]);
  });

  it("rejects retired and unknown ids", async () => {
    const mock = mockThemeApp();
    const router = new RPCRouter(mock.app);

    for (const theme of ["classic", "modern", "vivid", "neon"]) {
      const response = await router.execute(
        request("view.set_theme", { theme }),
      );
      expect(response.content.error?.message).toMatch(/tab10/);
    }
    expect(mock.themes).toEqual([]);
  });
});
