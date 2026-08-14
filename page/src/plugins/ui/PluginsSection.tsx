import { Loader2, Plus, RefreshCw, Trash2 } from "lucide-react";
import type React from "react";
import { useCallback, useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ViewerIconAction } from "@/components/viewer/ViewerIconAction";
import { cn } from "@/lib/utils";
import { SettingsSection } from "@/ui/layout/SettingsSection";
import { usePluginRuntimeStates } from "../hooks";
import { pluginManager } from "../manager";

interface PluginsSectionProps {
  sectionId?: string;
}

/**
 * Settings → Plugins: pipeline-cell row — checkbox is enable + status.
 */
export const PluginsSection: React.FC<PluginsSectionProps> = ({
  sectionId,
}) => {
  const plugins = usePluginRuntimeStates();
  const [source, setSource] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const onInstall = useCallback(async () => {
    const value = source.trim();
    if (!value) return;
    setBusy(true);
    setFormError(null);
    try {
      await pluginManager.install(value);
      setSource("");
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [source]);

  return (
    <SettingsSection id={sectionId} title="Plugins">
      <div className="flex items-end gap-0.5">
        <Tooltip delayDuration={300}>
          <TooltipTrigger asChild>
            <span className="min-w-0 flex-1">
              <Input
                value={source}
                onChange={(e) => setSource(e.target.value)}
                placeholder="owner/repo[@v1.2.3]"
                className="h-control-compact min-w-0 w-full rounded-none border-0 border-b border-border bg-transparent px-0 shadow-none focus-visible:border-accent focus-visible:ring-0"
                onKeyDown={(e) => {
                  if (e.key === "Enter") void onInstall();
                }}
                disabled={busy}
                aria-label="Plugin source"
              />
            </span>
          </TooltipTrigger>
          <TooltipContent>GitHub owner/repo, optional @tag.</TooltipContent>
        </Tooltip>
        <ViewerIconAction
          icon={busy ? <Loader2 className="animate-spin" /> : <Plus />}
          label="Add"
          disabled={busy || !source.trim()}
          onClick={() => void onInstall()}
        />
      </div>

      {formError ? (
        <p className="truncate text-micro text-destructive" title={formError}>
          {formError}
        </p>
      ) : null}

      {plugins.length === 0 ? null : (
        <ul className="divide-y divide-border">
          {plugins.map((p) => {
            const title = p.name ?? p.id ?? p.source;
            const dimmed = !p.enabled;
            return (
              <li
                key={p.source}
                className="flex flex-wrap items-center gap-1.5 py-1.5 first:pt-0 last:pb-0"
              >
                <EnableStatus
                  title={title}
                  enabled={p.enabled}
                  status={p.status}
                  error={p.error}
                  onToggle={() => {
                    void pluginManager.setEnabled(p.source, !p.enabled);
                  }}
                />
                <div className="min-w-0 flex-1">
                  <div
                    className={cn(
                      "truncate text-xs font-medium",
                      dimmed &&
                        "text-subtle-foreground line-through decoration-1",
                    )}
                  >
                    {title}
                    {p.version ? (
                      <span className="ml-1 font-normal text-muted-foreground no-underline">
                        {p.version}
                      </span>
                    ) : null}
                  </div>
                  <div
                    className="truncate font-mono text-micro text-muted-foreground"
                    title={
                      p.resolvedRef && !p.source.includes("@")
                        ? `${p.source} → ${p.resolvedRef}`
                        : p.source
                    }
                  >
                    {p.source}
                    {p.resolvedRef && !p.source.includes("@") ? (
                      <span className="text-muted-foreground/80">
                        {" "}
                        @{p.resolvedRef}
                      </span>
                    ) : null}
                  </div>
                </div>
                <ViewerIconAction
                  icon={<RefreshCw />}
                  label="Reload"
                  onClick={() => void pluginManager.reload(p.source)}
                />
                <ViewerIconAction
                  icon={<Trash2 />}
                  label="Remove"
                  className="text-destructive hover:text-destructive"
                  onClick={() => void pluginManager.uninstall(p.source)}
                />
                {p.status === "error" && p.error ? (
                  <p className="w-full break-words pl-5 font-mono text-micro text-destructive">
                    {p.error}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </SettingsSection>
  );
};

function EnableStatus({
  title,
  enabled,
  status,
  error,
  onToggle,
}: {
  title: string;
  enabled: boolean;
  status: string;
  error?: string;
  onToggle: () => void;
}) {
  if (status === "loading") {
    return (
      <span
        className="flex size-4 shrink-0 items-center justify-center text-muted-foreground"
        title="Loading"
      >
        <Loader2 className="size-3.5 animate-spin" aria-hidden />
        <span className="sr-only">Loading {title}</span>
      </span>
    );
  }

  return (
    <Checkbox
      aria-label={enabled ? `Disable ${title}` : `Enable ${title}`}
      title={status === "error" ? (error ?? "Error") : undefined}
      checked={enabled}
      onCheckedChange={() => onToggle()}
    />
  );
}
