/**
 * Left advanced-panel mode: Compute charts vs dedicated modifier config.
 *
 * Compute-nature / mesh-building pipeline modifiers
 * (`usesLeftConfig`) call {@link openLeftForModifier} when **added or
 * selected** so the left column shows **compute** parameters
 * (`surface="compute"`). The pipeline bottom pane shows **draw**
 * parameters only (`surface="draw"`). Pure charts stay in Compute mode.
 */

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";

export type LeftShellMode = "compute" | "modifier-config" | "optimize";

export interface LeftShellState {
  mode: LeftShellMode;
  /** Pipeline modifier id when mode is `modifier-config`. */
  modifierId: string | null;
  openLeftForModifier: (modifierId: string) => void;
  closeLeftToCompute: () => void;
  setOptimizeMode: () => void;
  setComputeMode: () => void;
}

const LeftShellContext = createContext<LeftShellState | null>(null);

export function LeftShellProvider({
  children,
  onOpen,
}: {
  children: ReactNode;
  /** Ensure the left advanced panel is visible (drawer / inline column). */
  onOpen?: () => void;
}) {
  const [mode, setMode] = useState<LeftShellMode>("compute");
  const [modifierId, setModifierId] = useState<string | null>(null);

  const openLeftForModifier = useCallback(
    (id: string) => {
      setModifierId(id);
      setMode("modifier-config");
      onOpen?.();
    },
    [onOpen],
  );

  const closeLeftToCompute = useCallback(() => {
    setModifierId(null);
    setMode("compute");
  }, []);

  const setOptimizeMode = useCallback(() => {
    setModifierId(null);
    setMode("optimize");
  }, []);

  const setComputeMode = useCallback(() => {
    setModifierId(null);
    setMode("compute");
  }, []);

  const value = useMemo(
    () => ({
      mode,
      modifierId,
      openLeftForModifier,
      closeLeftToCompute,
      setOptimizeMode,
      setComputeMode,
    }),
    [
      mode,
      modifierId,
      openLeftForModifier,
      closeLeftToCompute,
      setOptimizeMode,
      setComputeMode,
    ],
  );

  return (
    <LeftShellContext.Provider value={value}>
      {children}
    </LeftShellContext.Provider>
  );
}

export function useLeftShell(): LeftShellState {
  const ctx = useContext(LeftShellContext);
  if (!ctx) {
    throw new Error("useLeftShell must be used within LeftShellProvider");
  }
  return ctx;
}

/** Optional hook for components that may render outside the provider (tests). */
export function useLeftShellOptional(): LeftShellState | null {
  return useContext(LeftShellContext);
}
