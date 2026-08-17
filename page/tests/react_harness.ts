/**
 * Real-React-DOM harness for page component tests: `createRoot` + `act` in the
 * browser test environment, with no test-library dependency.
 *
 * Every component test mounts into its own throwaway host and unmounts in a
 * `finally`, so one panel can never leak effects into the next.
 */

import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";

type ActEnvironment = typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT: boolean;
};

/** React 19 rejects `act()` unless the environment declares itself a test. */
export function enableReactActEnvironment(): void {
  (globalThis as ActEnvironment).IS_REACT_ACT_ENVIRONMENT = true;
}

export interface MountedComponent {
  host: HTMLElement;
  cleanup: () => Promise<void>;
}

/** Mount one component tree and hand back its host plus its teardown. */
export async function mountComponent(
  node: ReactNode,
): Promise<MountedComponent> {
  enableReactActEnvironment();
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(node);
  });
  return {
    host,
    cleanup: async () => {
      await act(async () => {
        root.unmount();
      });
      host.remove();
    },
  };
}
