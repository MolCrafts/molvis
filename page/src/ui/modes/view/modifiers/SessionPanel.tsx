import type { Session } from "@molcrafts/molvis-stage";
import { AlertCircle, Link2, Link2Off, Loader2 } from "lucide-react";
import type React from "react";
import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { ViewerAction } from "@/components/viewer/ViewerAction";
import {
  type BackendStatus,
  type BackendTarget,
  useBackendConnection,
} from "@/hooks/useBackendConnection";

const STATUS_COPY: Record<BackendStatus, { label: string; className: string }> =
  {
    idle: { label: "Not connected", className: "text-muted-foreground" },
    connecting: { label: "Connecting…", className: "text-muted-foreground" },
    connected: {
      label: "Connected",
      className: "text-status-completed-foreground",
    },
    error: { label: "Error", className: "text-status-failed-foreground" },
  };

function StatusBadge({ status }: { status: BackendStatus }) {
  const { label, className } = STATUS_COPY[status];
  const Icon =
    status === "connecting"
      ? Loader2
      : status === "connected"
        ? Link2
        : status === "error"
          ? AlertCircle
          : Link2Off;
  return (
    <div
      className={`flex items-center gap-1 text-micro ${className}`}
      aria-live="polite"
    >
      <Icon
        className={`h-3 w-3 ${status === "connecting" ? "animate-spin" : ""}`}
      />
      <span>{label}</span>
    </div>
  );
}

/**
 * Parse a pasted URL of the form ``ws://host:port/ws?token=…&session=…``
 * into a {@link BackendTarget}. Token and session are pulled out of the query
 * string so the browser's hello frame sends them in the right shape; the
 * socket URL keeps the query (harmless) so copy/paste stays idempotent.
 */
function parseConnectionUrl(raw: string): BackendTarget | { error: string } {
  const trimmed = raw.trim();
  if (!trimmed)
    return { error: "Paste the ws:// URL from your Python script." };
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { error: "Not a valid URL." };
  }
  if (parsed.protocol !== "ws:" && parsed.protocol !== "wss:") {
    return { error: "URL must use ws:// or wss://" };
  }
  return {
    wsUrl: trimmed,
    token: parsed.searchParams.get("token") ?? undefined,
    session: parsed.searchParams.get("session") ?? undefined,
  };
}

interface SessionPanelProps {
  /** The row this panel belongs to. Absent while nothing is connected. */
  modifier?: Session;
}

/**
 * Properties panel for the controller {@link Session} row.
 *
 * This used to be a section in the settings dialog. It moved because settings
 * are preferences and this is a live resource with a status — it grew a
 * connection state badge, which is the tell. It now sits where every other
 * live thing sits: as a row in the pipeline list.
 *
 * The connection lifecycle still belongs to `useBackendConnection`, not to
 * this component or to the `Session` entry: a Jupyter page is connected from
 * URL parameters before any of this renders.
 */
export const SessionPanel: React.FC<SessionPanelProps> = () => {
  const conn = useBackendConnection();
  const [urlText, setUrlText] = useState<string>(() => conn.wsUrl ?? "");
  const [parseError, setParseError] = useState<string | null>(null);

  useEffect(() => {
    setUrlText(conn.wsUrl ?? "");
  }, [conn.wsUrl]);

  const onConnect = () => {
    const parsed = parseConnectionUrl(urlText);
    if ("error" in parsed) {
      setParseError(parsed.error);
      return;
    }
    setParseError(null);
    conn.connect(parsed);
  };

  const shownError = parseError ?? conn.error;

  return (
    <div className="space-y-2 p-2">
      <StatusBadge status={conn.status} />

      <Input
        id="session-url"
        className="h-control-compact font-mono text-xs"
        placeholder="ws://…/ws?token=…&session=…"
        aria-label="Controller WebSocket URL"
        value={urlText}
        onChange={(e) => {
          setUrlText(e.target.value);
          if (parseError) setParseError(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") onConnect();
        }}
      />

      {conn.session ? (
        <p className="truncate font-mono text-micro text-muted-foreground">
          {conn.session}
        </p>
      ) : null}

      {shownError && (
        <div className="flex items-start gap-1 text-micro text-status-failed-foreground">
          <AlertCircle className="mt-1 h-3 w-3 shrink-0" />
          <span className="break-all">{shownError}</span>
        </div>
      )}

      <div className="flex items-center gap-2 pt-1">
        <ViewerAction
          className="flex-1"
          onClick={onConnect}
          disabled={urlText.trim().length === 0 || conn.status === "connecting"}
        >
          {conn.status === "connected" ? "Reconnect" : "Connect"}
        </ViewerAction>
        <ViewerAction
          purpose="dismiss"
          onClick={() => {
            setUrlText("");
            conn.disconnect();
          }}
          disabled={conn.status === "idle"}
        >
          Disconnect
        </ViewerAction>
      </div>
    </div>
  );
};
