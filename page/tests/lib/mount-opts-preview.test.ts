import { describe, expect, it } from "@rstest/core";
import { isReadonlySurface, resolveChrome } from "../../src/lib/mount-opts";

describe("preview surface", () => {
  it("is the read-only mode; full and canvas are editors", () => {
    expect(isReadonlySurface("preview")).toBe(true);
    expect(isReadonlySurface("full")).toBe(false);
    expect(isReadonlySurface("canvas")).toBe(false);
    expect(isReadonlySurface(undefined)).toBe(false);
  });

  it("keeps the header and drops rails, status and timeline", () => {
    expect(resolveChrome({ surface: "preview" })).toEqual({
      topBar: true,
      leftSidebar: false,
      rightSidebar: false,
      statusBar: false,
      timeline: false,
    });
  });
});
