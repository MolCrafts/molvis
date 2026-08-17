import { describe, expect, it } from "@rstest/core";
import pkg from "../package.json";

/**
 * `core` is the layer both engines depend on. The moment it needs Babylon,
 * too much has moved down and the sink has gone wrong — sinking `Settings`
 * would have done exactly that (8 Babylon references), which is why it stayed
 * in `stage`.
 *
 * This is the boundary that makes the layering checkable rather than a
 * convention people remember.
 */
describe("core stays engine-free", () => {
  const deps = {
    ...(pkg.dependencies ?? {}),
    ...((pkg as { peerDependencies?: Record<string, string> })
      .peerDependencies ?? {}),
  };

  it("declares no rendering engine dependency", () => {
    const rendering = Object.keys(deps).filter((name) =>
      /babylonjs|three|@molcrafts\/molvis-stage|@molcrafts\/molvis-sketch/.test(
        name,
      ),
    );
    expect(rendering).toEqual([]);
  });

  it("declares no dependency on a package that depends on it", () => {
    // core is the root of the graph: nothing upstream of it may appear here.
    expect(Object.keys(deps)).not.toContain("@molcrafts/molvis-plugin");
    expect(Object.keys(deps)).not.toContain("page");
  });
});
