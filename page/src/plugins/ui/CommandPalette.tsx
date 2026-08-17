/**
 * VS Code–style command palette (Ctrl/Cmd+Shift+P).
 *
 * Plugin discovery surface: commands, dialogs, modes, and bottom panels.
 * Plugins must not inject chrome into the native toolbar / mode strip —
 * they register contributions; users run them from this palette.
 */

import type { Molvis } from "@molcrafts/molvis-stage";
import { Search } from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cacheGroups, clearGroups } from "@/lib/molvis-storage";
import { cn } from "@/lib/utils";
import { openBottomPanel } from "../contributions/bottom_panel_host";
import { openPluginDialog } from "../contributions/dialog_host";
import {
  dialogStore,
  modeTabStore,
  panelStore,
  toolbarActionStore,
} from "../contributions/ui";

/**
 * The palette must paint above plugin-supplied chrome, and plugins pick
 * their own z-indices with no host-imposed scale. Until the host publishes
 * one, this sits just below the int32 ceiling so nothing can outbid it by
 * accident.
 */
const PALETTE_Z_CLASS = "z-[2147483000]";

/**
 * Drop the host's cached files plus every cache the active plugins
 * declared — Python cells and scripts included, because the pyodide
 * plugin opts them in itself.
 */
async function clearCache(app: Molvis | null): Promise<void> {
  try {
    const groups = cacheGroups();
    const before = await Promise.all(groups.map((g) => g.describe()));
    await clearGroups(groups);
    const emptied = before.filter((d) => d !== "empty");
    app?.events.emit("status-message", {
      text:
        emptied.length === 0
          ? "Nothing cached to clear"
          : `Cleared ${emptied.join(", ")}`,
      type: "success",
    });
  } catch (err) {
    app?.events.emit("status-message", {
      text: `Could not clear the cache: ${err instanceof Error ? err.message : String(err)}`,
      type: "error",
    });
  }
}

export interface CommandPaletteProps {
  app: Molvis | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Switch viewer mode (built-in or plugin). */
  onModeChange?: (mode: string) => void;
  /** Restart the viewer in place. */
  onReload?: () => void;
  /** Open the reset dialog (it owns the destructive choice). */
  onReset?: () => void;
}

export interface PaletteItem {
  id: string;
  label: string;
  detail?: string;
  category: string;
  run: () => void;
}

function scoreMatch(query: string, label: string, detail?: string): number {
  const q = query.trim().toLowerCase();
  if (!q) return 1;
  const hay = `${label} ${detail ?? ""}`.toLowerCase();
  if (hay === q) return 100;
  if (hay.startsWith(q)) return 80;
  if (hay.includes(q)) return 50;
  // subsequence
  let i = 0;
  for (const ch of hay) {
    if (ch === q[i]) i += 1;
    if (i >= q.length) return 20;
  }
  return 0;
}

function useStoreTick(subscribe: (l: () => void) => () => void): number {
  const [tick, setTick] = useState(0);
  useEffect(() => subscribe(() => setTick((t) => t + 1)), [subscribe]);
  return tick;
}

export function buildPaletteItems(
  app: Molvis | null,
  onModeChange?: (mode: string) => void,
  onReload?: () => void,
  onReset?: () => void,
): PaletteItem[] {
  const items: PaletteItem[] = [];

  // Primary plugin discovery: commands with toolbar metadata.
  // A command that opens a dialog (opensDialog) or switches a mode (label
  // shares the mode tab name) is the single palette row — do not also list
  // that dialog/mode. That was producing two entries for every plugin action.
  const toolbarActions = toolbarActionStore.list();
  const dialogsOpenedByCommand = new Set(
    toolbarActions
      .map((a) => a.opensDialog)
      .filter((id): id is string => typeof id === "string" && id.length > 0),
  );

  for (const action of toolbarActions) {
    if (app && action.isVisible && !action.isVisible(app)) continue;
    items.push({
      id: `cmd:${action.id}`,
      label: action.label,
      detail: action.id,
      category: "Command",
      run: () => {
        if (app) action.onClick(app);
      },
    });
  }

  for (const d of dialogStore.list()) {
    if (dialogsOpenedByCommand.has(d.id)) continue;
    items.push({
      id: `dialog:${d.id}`,
      label: d.title,
      detail: d.id,
      category: "Dialog",
      run: () => openPluginDialog(d.id),
    });
  }

  // Plugin modes also live in the StructureInspector strip. Skip a mode
  // tab when any palette command already covers it (shared name / mode id).
  for (const tab of modeTabStore.list()) {
    const label = tab.label.toLowerCase();
    const covered = toolbarActions.some((a) => {
      const al = a.label.toLowerCase();
      return (
        a.id.includes(tab.mode) ||
        al.includes(label) ||
        label.includes(al.replace(/^mode:\s*/, ""))
      );
    });
    if (covered) continue;
    items.push({
      id: `mode:${tab.mode}`,
      label: `Mode: ${tab.label}`,
      detail: tab.mode,
      category: "Mode",
      run: () => onModeChange?.(tab.mode),
    });
  }

  for (const p of panelStore.list().filter((x) => x.position === "bottom")) {
    items.push({
      id: `panel:${p.id}`,
      label: `Panel: ${p.title}`,
      detail: p.id,
      category: "Panel",
      run: () => openBottomPanel(p.id),
    });
  }

  // Built-in host actions (always available).
  if (app) {
    items.push(
      {
        id: "builtin:save",
        label: "Save scene",
        detail: "Ctrl/⌘+S",
        category: "Built-in",
        run: () => app.commitScene(),
      },
      {
        id: "builtin:undo",
        label: "Undo",
        detail: "Ctrl/⌘+Z",
        category: "Built-in",
        run: () => app.commandManager.undo(),
      },
      {
        id: "builtin:redo",
        label: "Redo",
        detail: "Ctrl/⌘+Shift+Z",
        category: "Built-in",
        run: () => app.commandManager.redo(),
      },
      {
        id: "builtin:mode-view",
        label: "Mode: View",
        category: "Built-in",
        run: () => onModeChange?.("view"),
      },
      {
        id: "builtin:mode-select",
        label: "Mode: Select",
        category: "Built-in",
        run: () => onModeChange?.("select"),
      },
      {
        id: "builtin:mode-edit",
        label: "Mode: Edit",
        category: "Built-in",
        run: () => onModeChange?.("edit"),
      },
      {
        id: "builtin:reload",
        label: "Reload MolVis",
        detail: "Restart the viewer without touching stored data",
        category: "Built-in",
        run: () => onReload?.(),
      },
      {
        id: "builtin:clear-cache",
        label: "Clear cache",
        detail: "Cached files plus plugin caches (Python cells, scripts)",
        category: "Built-in",
        run: () => {
          void clearCache(app);
        },
      },
      {
        id: "builtin:reset",
        label: "Reset MolVis…",
        detail: "Choose what stored data to erase, then restart",
        category: "Built-in",
        run: () => onReset?.(),
      },
    );
  }

  return items;
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  app,
  open,
  onOpenChange,
  onModeChange,
  onReload,
  onReset,
}) => {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Re-render when any contribution store changes.
  const tickToolbar = useStoreTick((l) => toolbarActionStore.subscribe(l));
  const tickDialog = useStoreTick((l) => dialogStore.subscribe(l));
  const tickMode = useStoreTick((l) => modeTabStore.subscribe(l));
  const tickPanel = useStoreTick((l) => panelStore.subscribe(l));
  const storeTick = tickToolbar + tickDialog + tickMode + tickPanel;

  const allItems = useMemo(() => {
    void storeTick; // recompute when contribution stores emit
    return buildPaletteItems(app, onModeChange, onReload, onReset);
  }, [app, onModeChange, onReload, onReset, storeTick]);

  const filtered = useMemo(() => {
    const scored = allItems
      .map((item) => ({
        item,
        score: scoreMatch(query, item.label, item.detail),
      }))
      .filter((x) => x.score > 0)
      .sort(
        (a, b) => b.score - a.score || a.item.label.localeCompare(b.item.label),
      );
    return scored.map((x) => x.item);
  }, [allItems, query]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActive(0);
    const t = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, [open]);

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(
      `[data-palette-index="${active}"]`,
    );
    el?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const runItem = useCallback(
    (item: PaletteItem) => {
      onOpenChange(false);
      try {
        item.run();
      } catch (err) {
        console.error("[command-palette]", err);
      }
    },
    [onOpenChange],
  );

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onOpenChange(false);
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive((i) => Math.min(i + 1, Math.max(filtered.length - 1, 0)));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const item = filtered[active];
        if (item) runItem(item);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, filtered, active, onOpenChange, runItem]);

  if (!open) return null;

  return (
    // Backdrop is a click target only — it carries no role and is not
    // focusable. Escape is handled by the window listener above, so exposing
    // the scrim as a tabbable "button" only added a phantom stop for
    // keyboard and screen-reader users.
    // biome-ignore lint/a11y/useKeyWithClickEvents: click-outside scrim; the window Escape listener is the keyboard path.
    // biome-ignore lint/a11y/noStaticElementInteractions: giving the scrim a role would put a phantom stop in the tab order.
    <div
      className={`fixed inset-0 ${PALETTE_Z_CLASS} flex items-start justify-center bg-black/40 pt-[12vh] px-4`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onOpenChange(false);
      }}
    >
      <div
        role="dialog"
        aria-label="Command palette"
        aria-modal="true"
        className="flex w-full max-w-xl flex-col overflow-hidden rounded-control border border-border bg-background shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-border/70 px-3 py-2">
          <Search
            className="size-4 shrink-0 text-muted-foreground"
            aria-hidden
          />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            placeholder="Type a command…"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            aria-autocomplete="list"
            aria-controls="molvis-command-palette-list"
          />
          <kbd className="hidden shrink-0 rounded border border-border/70 px-1.5 py-0.5 font-mono text-micro text-muted-foreground sm:inline">
            Esc
          </kbd>
        </div>
        <div
          id="molvis-command-palette-list"
          ref={listRef}
          role="listbox"
          className="max-h-[min(50vh,360px)] overflow-y-auto py-1"
        >
          {filtered.length === 0 ? (
            <div className="px-3 py-6 text-center text-xs text-muted-foreground">
              No matching commands
            </div>
          ) : (
            filtered.map((item, index) => (
              <button
                key={item.id}
                type="button"
                role="option"
                aria-selected={index === active}
                data-palette-index={index}
                className={cn(
                  "flex w-full items-center gap-3 px-3 py-2 text-left text-sm",
                  index === active
                    ? "bg-interactive text-foreground"
                    : "text-foreground/90 hover:bg-interactive/60",
                )}
                onMouseEnter={() => setActive(index)}
                onClick={() => runItem(item)}
              >
                <span className="min-w-0 flex-1 truncate font-medium">
                  {item.label}
                </span>
                <span className="shrink-0 text-micro text-muted-foreground">
                  {item.category}
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

/** Global hotkey: Ctrl/Cmd+Shift+P opens the command palette. */
export function useCommandPaletteHotkey(
  onOpen: () => void,
  enabled = true,
): void {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const mod = e.ctrlKey || e.metaKey;
      if (!mod || !e.shiftKey) return;
      if (e.key.toLowerCase() !== "p") return;
      // Avoid clashing with browser print when only Ctrl+P (no shift).
      e.preventDefault();
      e.stopPropagation();
      onOpen();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onOpen, enabled]);
}
