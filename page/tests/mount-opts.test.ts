import { describe, expect, it } from "@rstest/core";
import { readMountOptsFromHost, resolveChrome } from "../src/lib/mount-opts";

// Pure unit tests for the surface/flag model. resolveChrome is a
// pure function — no DOM or React needed. readMountOptsFromHost
// is tested with a minimal window mock.

describe("resolveChrome", () => {
  it("surface full → all flags true", () => {
    const result = resolveChrome({ surface: "full" });
    expect(result.topBar).toBe(true);
    expect(result.leftSidebar).toBe(true);
    expect(result.rightSidebar).toBe(true);
    expect(result.statusBar).toBe(true);
    expect(result.timeline).toBe(true);
  });

  it("surface canvas → all flags false", () => {
    const result = resolveChrome({ surface: "canvas" });
    expect(result.topBar).toBe(false);
    expect(result.leftSidebar).toBe(false);
    expect(result.rightSidebar).toBe(false);
    expect(result.statusBar).toBe(false);
    expect(result.timeline).toBe(false);
  });

  it("minimal:true → same as canvas (backward-compat alias)", () => {
    const fromMinimal = resolveChrome({ minimal: true });
    const fromCanvas = resolveChrome({ surface: "canvas" });
    expect(fromMinimal).toEqual(fromCanvas);
  });

  it("default (no surface, no minimal) → all true", () => {
    const result = resolveChrome({});
    expect(result.topBar).toBe(true);
    expect(result.leftSidebar).toBe(true);
    expect(result.rightSidebar).toBe(true);
    expect(result.statusBar).toBe(true);
    expect(result.timeline).toBe(true);
  });

  it("chrome override wins over surface preset", () => {
    const result = resolveChrome({
      surface: "full",
      chrome: { leftSidebar: false, statusBar: false },
    });
    expect(result.topBar).toBe(true);
    expect(result.leftSidebar).toBe(false); // overridden
    expect(result.rightSidebar).toBe(true);
    expect(result.statusBar).toBe(false); // overridden
    expect(result.timeline).toBe(true);
  });

  it("chrome partial override on canvas surface", () => {
    const result = resolveChrome({
      surface: "canvas",
      chrome: { topBar: true },
    });
    expect(result.topBar).toBe(true); // turned on via override
    expect(result.leftSidebar).toBe(false);
    expect(result.rightSidebar).toBe(false);
    expect(result.statusBar).toBe(false);
    expect(result.timeline).toBe(false);
  });

  it("surface takes precedence over minimal when both set", () => {
    // surface is explicit; minimal is only a fallback
    const result = resolveChrome({ surface: "full", minimal: true });
    expect(result.topBar).toBe(true);
    expect(result.leftSidebar).toBe(true);
  });
});

describe("readMountOptsFromHost", () => {
  it("returns empty object when __MOLVIS_VSCODE_INIT__ is absent", () => {
    // In a pure Node test, window is undefined — the function guards this.
    const result = readMountOptsFromHost();
    expect(result).toEqual({});
  });

  it("returns empty object when mount key is missing", () => {
    // Simulate an init object without mount — the function reads
    // __MOLVIS_VSCODE_INIT__.mount specifically.
    const saved = (globalThis as Record<string, unknown>)
      .__MOLVIS_VSCODE_INIT__;
    (globalThis as Record<string, unknown>).__MOLVIS_VSCODE_INIT__ = {
      config: {},
    };
    try {
      const result = readMountOptsFromHost();
      expect(result).toEqual({});
    } finally {
      if (saved !== undefined) {
        (globalThis as Record<string, unknown>).__MOLVIS_VSCODE_INIT__ = saved;
      } else {
        delete (globalThis as Record<string, unknown>).__MOLVIS_VSCODE_INIT__;
      }
    }
  });

  it("returns mount.surface from the host payload", () => {
    const saved = (globalThis as Record<string, unknown>)
      .__MOLVIS_VSCODE_INIT__;
    (globalThis as Record<string, unknown>).__MOLVIS_VSCODE_INIT__ = {
      mount: { surface: "full" },
    };
    try {
      const result = readMountOptsFromHost();
      expect(result).toEqual({ surface: "full" });
    } finally {
      if (saved !== undefined) {
        (globalThis as Record<string, unknown>).__MOLVIS_VSCODE_INIT__ = saved;
      } else {
        delete (globalThis as Record<string, unknown>).__MOLVIS_VSCODE_INIT__;
      }
    }
  });
});
