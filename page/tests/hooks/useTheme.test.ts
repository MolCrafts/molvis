import { afterEach, describe, expect, it } from "@rstest/core";
import {
  bootstrapTheme,
  registerThemeRoot,
  unregisterThemeRoot,
} from "@/hooks/useTheme";

describe("useTheme roots", () => {
  afterEach(() => {
    document.documentElement.classList.remove("dark");
    try {
      localStorage.removeItem("molvis-theme");
    } catch {
      /* ignore */
    }
  });

  it("applies dark class to documentElement on bootstrap", () => {
    localStorage.setItem("molvis-theme", "dark");
    bootstrapTheme();
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("mirrors light/dark onto registered shadow hosts", () => {
    localStorage.setItem("molvis-theme", "dark");
    const host = document.createElement("div");
    registerThemeRoot(host);
    expect(host.classList.contains("dark")).toBe(true);

    localStorage.setItem("molvis-theme", "light");
    bootstrapTheme();
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(host.classList.contains("dark")).toBe(false);

    unregisterThemeRoot(host);
  });

  it("seeds storage from registerThemeRoot only when empty", () => {
    localStorage.removeItem("molvis-theme");
    const host = document.createElement("div");
    registerThemeRoot(host, "dark");
    expect(localStorage.getItem("molvis-theme")).toBe("dark");
    expect(host.classList.contains("dark")).toBe(true);

    // Second seed must not clobber a user preference.
    localStorage.setItem("molvis-theme", "light");
    const host2 = document.createElement("div");
    registerThemeRoot(host2, "dark");
    expect(localStorage.getItem("molvis-theme")).toBe("light");
    expect(host2.classList.contains("dark")).toBe(false);

    unregisterThemeRoot(host);
    unregisterThemeRoot(host2);
  });
});
