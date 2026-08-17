import { attachWebSocketBridge, type Molvis } from "@molcrafts/molvis-stage";
import type React from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

export type BackendStatus = "idle" | "connecting" | "connected" | "error";

export interface BackendTarget {
  wsUrl: string;
  token?: string;
  session?: string;
}

export interface BackendConnection {
  status: BackendStatus;
  wsUrl: string | null;
  token: string | null;
  session: string | null;
  error: string | null;
  connect(target: BackendTarget): void;
  disconnect(): void;
}

const BackendCtx = createContext<BackendConnection | null>(null);

export function useBackendConnection(): BackendConnection {
  const value = useContext(BackendCtx);
  if (value === null) {
    throw new Error(
      "useBackendConnection must be used inside <BackendConnectionProvider>",
    );
  }
  return value;
}

interface ConfigState {
  wsUrl: string | null;
  token: string | null;
  session: string | null;
}

interface ProviderProps {
  app: Molvis | null;
  initial?: {
    wsUrl?: string;
    token?: string;
    session?: string;
  };
  children: React.ReactNode;
}

export const BackendConnectionProvider: React.FC<ProviderProps> = ({
  app,
  initial,
  children,
}) => {
  const [config, setConfig] = useState<ConfigState>(() => ({
    wsUrl: initial?.wsUrl ?? null,
    token: initial?.token ?? null,
    session: initial?.session ?? null,
  }));
  const [status, setStatus] = useState<BackendStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const activeDisposerRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    activeDisposerRef.current?.();
    activeDisposerRef.current = null;

    if (!app || !config.wsUrl) {
      setStatus("idle");
      setError(null);
      return;
    }

    setStatus("connecting");
    setError(null);

    let cancelled = false;
    const dispose = attachWebSocketBridge(app, {
      wsUrl: config.wsUrl,
      token: config.token ?? undefined,
      session: config.session ?? undefined,
      onConnected: () => {
        if (!cancelled) setStatus("connected");
      },
      onError: (err) => {
        if (cancelled) return;
        setStatus("error");
        setError(err instanceof Error ? err.message : String(err));
      },
    });

    activeDisposerRef.current = dispose;
    return () => {
      cancelled = true;
      activeDisposerRef.current = null;
      dispose();
    };
  }, [app, config.wsUrl, config.token, config.session]);

  const connect = useCallback((target: BackendTarget) => {
    setConfig({
      wsUrl: target.wsUrl,
      token: target.token ?? null,
      session: target.session ?? null,
    });
  }, []);

  const disconnect = useCallback(() => {
    setConfig({ wsUrl: null, token: null, session: null });
  }, []);

  const value: BackendConnection = {
    status,
    wsUrl: config.wsUrl,
    token: config.token,
    session: config.session,
    error,
    connect,
    disconnect,
  };

  return <BackendCtx.Provider value={value}>{children}</BackendCtx.Provider>;
};
