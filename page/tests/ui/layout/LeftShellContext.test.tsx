import { describe, expect, it } from "@rstest/core";
import { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import {
  LeftShellProvider,
  type LeftShellState,
  useLeftShell,
} from "@/ui/layout/LeftShellContext";

function Probe({ onReady }: { onReady: (shell: LeftShellState) => void }) {
  const shell = useLeftShell();
  useEffect(() => {
    onReady(shell);
  }, [shell, onReady]);
  return null;
}

describe("LeftShellContext", () => {
  it("opens modifier-config mode and notifies onOpen", async () => {
    let openCount = 0;
    let shell: LeftShellState | null = null;

    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(
        <LeftShellProvider
          onOpen={() => {
            openCount += 1;
          }}
        >
          <Probe
            onReady={(s) => {
              shell = s;
            }}
          />
        </LeftShellProvider>,
      );
    });

    expect(shell).not.toBeNull();
    expect(shell?.mode).toBe("compute");
    expect(shell?.modifierId).toBeNull();

    await act(async () => {
      shell?.openLeftForModifier("iso-1");
    });

    expect(shell?.mode).toBe("modifier-config");
    expect(shell?.modifierId).toBe("iso-1");
    expect(openCount).toBe(1);

    await act(async () => {
      shell?.closeLeftToCompute();
    });

    expect(shell?.mode).toBe("compute");
    expect(shell?.modifierId).toBeNull();

    await act(async () => {
      root.unmount();
    });
    host.remove();
  });
});
