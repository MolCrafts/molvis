import { Session } from "@molcrafts/molvis-stage";
import { describe, expect, it } from "@rstest/core";
import { BackendConnectionProvider } from "@/hooks/useBackendConnection";
import { registerBuiltinModifierPanels } from "@/plugins";
import { ModifierProperties } from "@/ui/modes/view/ModifierProperties";
import { getAvailableParents } from "@/ui/modes/view/pipeline/tree_utils";
import { mountComponent } from "../../../react_harness";

describe("ModifierProperties", () => {
  it("renders a Session without reading modifier capabilities", async () => {
    registerBuiltinModifierPanels();
    const session = new Session("alpha", "ws://local/ws", () => undefined);
    const mounted = await mountComponent(
      <BackendConnectionProvider app={null}>
        <ModifierProperties
          modifier={session}
          allEntries={[session]}
          app={null}
          onUpdate={() => undefined}
        />
      </BackendConnectionProvider>,
    );
    try {
      expect(mounted.host.textContent).toContain("Session");
      expect(mounted.host.textContent).toContain("Not connected");
      expect(mounted.host.querySelector("#session-url")).not.toBeNull();
    } finally {
      await mounted.cleanup();
    }
  });

  it("does not offer a Session as a selection parent", () => {
    const session = new Session("alpha", "ws://local/ws", () => undefined);
    expect(getAvailableParents("other", [session])).toEqual([]);
  });
});
