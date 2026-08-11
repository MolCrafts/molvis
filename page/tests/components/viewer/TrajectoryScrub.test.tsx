import { describe, expect, it } from "@rstest/core";
import { TrajectoryScrub } from "../../../src/components/viewer/TrajectoryScrub";
import { mountComponent } from "../../react_harness";

describe("TrajectoryScrub", () => {
  it("renders filmstrip track and bar thumb slots", async () => {
    const onValueChange = () => undefined;
    const { host, cleanup } = await mountComponent(
      <TrajectoryScrub value={3} max={10} onValueChange={onValueChange} />,
    );
    try {
      expect(host.querySelector('[data-slot="trajectory-scrub"]')).toBeTruthy();
      expect(
        host.querySelector('[data-slot="trajectory-scrub-track"]'),
      ).toBeTruthy();
      expect(
        host.querySelector('[data-slot="trajectory-scrub-thumb"]'),
      ).toBeTruthy();
      const root = host.querySelector(
        '[data-slot="trajectory-scrub"]',
      ) as HTMLElement;
      expect(root.getAttribute("aria-label")).toBe("Trajectory frame");
    } finally {
      await cleanup();
    }
  });
});
