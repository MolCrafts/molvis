import { describe, expect, it } from "@rstest/core";
import { act } from "react";
import { MountOptsRoot } from "../../src/lib/MountOptsRoot";
import { useMountOpts } from "../../src/lib/mount-opts";
import { MountOptsStore } from "../../src/lib/mount-opts-store";
import { mountComponent } from "../react_harness";

/** Reads the broadcast options into the DOM so a test can assert on them. */
function SurfaceProbe() {
  const opts = useMountOpts();
  return <span data-testid="surface">{opts.surface ?? "unset"}</span>;
}

function surfaceOf(host: HTMLElement): string | null {
  return host.querySelector('[data-testid="surface"]')?.textContent ?? null;
}

describe("MountOptsRoot", () => {
  it("broadcasts the store's initial options", async () => {
    const store = new MountOptsStore({ surface: "canvas" });
    const mounted = await mountComponent(
      <MountOptsRoot store={store}>
        <SurfaceProbe />
      </MountOptsRoot>,
    );
    try {
      expect(surfaceOf(mounted.host)).toBe("canvas");
    } finally {
      await mounted.cleanup();
    }
  });

  it("re-broadcasts when the store is patched", async () => {
    const store = new MountOptsStore({ surface: "canvas" });
    const mounted = await mountComponent(
      <MountOptsRoot store={store}>
        <SurfaceProbe />
      </MountOptsRoot>,
    );
    try {
      await act(async () => {
        store.patch({ surface: "full" });
      });
      // This is the whole point of the link: chrome is state, not a
      // mount-time computation.
      expect(surfaceOf(mounted.host)).toBe("full");
    } finally {
      await mounted.cleanup();
    }
  });

  it("carries no policy — a bare seed renders", async () => {
    // The decision of who owns the surface belongs to the host (`setOpts` /
    // `mountMolvisApp`), not to this adapter.
    const store = new MountOptsStore({});
    const mounted = await mountComponent(
      <MountOptsRoot store={store}>
        <SurfaceProbe />
      </MountOptsRoot>,
    );
    try {
      expect(surfaceOf(mounted.host)).toBe("unset");
    } finally {
      await mounted.cleanup();
    }
  });
});
