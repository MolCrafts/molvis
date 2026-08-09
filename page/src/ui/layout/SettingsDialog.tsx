import type { Molvis } from "@molcrafts/molvis-stage";
import {
  Camera,
  Grid3x3,
  Monitor,
  Palette,
  Puzzle,
  Settings,
  Share2,
  Sparkles,
} from "lucide-react";
import type React from "react";
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { ViewerIconAction } from "@/components/viewer/ViewerIconAction";
import { cn } from "@/lib/utils";
import {
  PluginsSection,
  usePluginRuntimeStates,
  usePluginSettingsSections,
} from "@/plugins";
import { AppearanceSection } from "./AppearanceSection";
import { AppSharingSection } from "./AppSharingSection";
import { CameraSection } from "./CameraSection";
import { GraphicsSection } from "./GraphicsSection";
import { GridSection } from "./GridSection";
import { SettingsSection } from "./SettingsSection";
import { StageStyleSection } from "./StageStyleSection";

interface SettingsDialogProps {
  app: Molvis | null;
}

interface SettingsNavItem {
  id: string;
  label: string;
  icon: React.ReactNode;
}

type SettingsEntry = SettingsNavItem & {
  group: string;
  groupLabel?: string;
  order?: number;
  content: React.ReactNode;
};

/** Centered group label between two shadcn Separators. */
function NavSeparator({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 px-1.5 pt-2.5 pb-1">
      <Separator className="min-w-0 flex-1" />
      <span className="shrink-0 text-[0.65rem] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <Separator className="min-w-0 flex-1" />
    </div>
  );
}

export const SettingsDialog: React.FC<SettingsDialogProps> = ({ app }) => {
  const pluginSections = usePluginSettingsSections();
  const pluginStates = usePluginRuntimeStates();
  const sections = useMemo<SettingsEntry[]>(() => {
    const builtIns: SettingsEntry[] = [
      {
        id: "appearance",
        label: "Appearance",
        group: "general",
        icon: <Palette className="size-3.5" aria-hidden />,
        content: <AppearanceSection app={app} sectionId="appearance" />,
      },
      {
        id: "plugins",
        label: "Plugins",
        group: "general",
        icon: <Puzzle className="size-3.5" aria-hidden />,
        content: <PluginsSection sectionId="plugins" />,
      },
      {
        id: "app-sharing",
        label: "App & sharing",
        group: "general",
        icon: <Share2 className="size-3.5" aria-hidden />,
        content: <AppSharingSection sectionId="app-sharing" />,
      },
      {
        id: "style",
        label: "Style",
        group: "stage",
        icon: <Sparkles className="size-3.5" aria-hidden />,
        content: <StageStyleSection app={app} sectionId="style" />,
      },
      {
        id: "graphics",
        label: "Graphics",
        group: "stage",
        icon: <Monitor className="size-3.5" aria-hidden />,
        content: <GraphicsSection app={app} sectionId="graphics" />,
      },
      {
        id: "grid",
        label: "Grid",
        group: "stage",
        icon: <Grid3x3 className="size-3.5" aria-hidden />,
        content: <GridSection app={app} sectionId="grid" />,
      },
      {
        id: "camera",
        label: "Camera",
        group: "stage",
        icon: <Camera className="size-3.5" aria-hidden />,
        content: <CameraSection app={app} sectionId="camera" />,
      },
    ];
    const contributed = pluginSections.map((section) => {
      const PluginSettings = section.render;
      const owner = pluginStates.find(
        (state) => state.id && section.id.startsWith(`plugin.${state.id}.`),
      );
      const groupLabel = section.group ?? owner?.name ?? "Plugin";
      return {
        id: section.id,
        label: section.title,
        group: `plugin:${groupLabel}`,
        groupLabel,
        order: section.order,
        icon: <Puzzle className="size-3.5" aria-hidden />,
        content: (
          <SettingsSection id={section.id} title={section.title}>
            <PluginSettings app={app} />
            {owner?.version ? (
              <div className="mt-6 text-right font-mono text-micro text-muted-foreground">
                v{owner.version}
              </div>
            ) : null}
          </SettingsSection>
        ),
      };
    });
    contributed.sort(
      (a, b) =>
        (a.groupLabel ?? "").localeCompare(b.groupLabel ?? "") ||
        (a.order ?? 0) - (b.order ?? 0),
    );
    return builtIns.concat(contributed);
  }, [app, pluginSections, pluginStates]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [activeId, setActiveId] = useState("appearance");
  const navLockUntil = useRef(0);
  const categoryIds = useMemo(
    () => sections.map((section) => section.id),
    [sections],
  );

  const scrollToCategory = useCallback((id: string) => {
    const root = scrollRef.current;
    if (!root) return;
    const target = root.querySelector<HTMLElement>(
      `[data-settings-section="${id}"]`,
    );
    if (!target) return;

    setActiveId(id);
    navLockUntil.current = performance.now() + 450;

    const top =
      target.getBoundingClientRect().top -
      root.getBoundingClientRect().top +
      root.scrollTop;
    root.scrollTo({ top: Math.max(0, top - 8), behavior: "smooth" });
  }, []);

  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;

    const nodes = categoryIds
      .map((id) =>
        root.querySelector<HTMLElement>(`[data-settings-section="${id}"]`),
      )
      .filter((el): el is HTMLElement => el != null);

    if (nodes.length === 0) return;

    const updateActive = () => {
      if (performance.now() < navLockUntil.current) return;

      const rootTop = root.getBoundingClientRect().top;
      const threshold = rootTop + root.clientHeight * 0.28;
      let current = nodes[0].dataset.settingsSection ?? nodes[0].id;

      for (const node of nodes) {
        const top = node.getBoundingClientRect().top;
        if (top <= threshold) {
          current = node.dataset.settingsSection ?? node.id;
        } else {
          break;
        }
      }
      setActiveId((prev) => (prev === current ? prev : current));
    };

    updateActive();
    root.addEventListener("scroll", updateActive, { passive: true });
    return () => root.removeEventListener("scroll", updateActive);
  }, [categoryIds]);

  return (
    <Dialog modal={false}>
      <DialogTrigger asChild>
        <ViewerIconAction icon={<Settings />} label="Settings" />
      </DialogTrigger>
      <DialogContent
        className={cn(
          "flex h-[min(85vh,40rem)] w-full flex-col gap-0 overflow-hidden p-0",
          "max-w-[min(46rem,calc(100vw-2rem))] sm:max-w-[min(46rem,calc(100vw-2rem))]",
        )}
      >
        <DialogHeader className="shrink-0 border-b border-border/70 px-5 py-3.5 pr-12">
          <DialogTitle>Settings</DialogTitle>
        </DialogHeader>

        <div className="flex min-h-0 flex-1">
          <nav
            aria-label="Settings categories"
            className="flex w-[9.5rem] shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-border/70 bg-panel/40 p-2 sm:w-44"
          >
            {sections.map((item, index) => {
              const isActive = activeId === item.id;
              return (
                <Fragment key={item.id}>
                  {item.group !== "general" &&
                  sections[index - 1]?.group !== item.group ? (
                    <NavSeparator label={item.groupLabel ?? item.group} />
                  ) : null}
                  <button
                    type="button"
                    onClick={() => scrollToCategory(item.id)}
                    aria-current={isActive ? "true" : undefined}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-control border-l-2 px-2.5 py-1.5 text-left text-micro transition-colors duration-(--motion-fast) ease-standard",
                      isActive
                        ? "border-accent bg-accent/12 font-medium text-foreground"
                        : "border-transparent text-muted-foreground hover:bg-interactive hover:text-foreground",
                    )}
                  >
                    <span
                      className={cn(
                        "shrink-0",
                        isActive ? "text-accent" : "text-muted-foreground",
                      )}
                    >
                      {item.icon}
                    </span>
                    <span className="truncate">{item.label}</span>
                  </button>
                </Fragment>
              );
            })}
          </nav>

          <div
            ref={scrollRef}
            className="min-w-0 flex-1 overflow-y-auto overscroll-contain"
          >
            <div className="space-y-0 px-5 py-4 sm:px-6">
              {sections.map((section, index) => (
                <div
                  key={section.id}
                  className={cn(
                    "py-5 first:pt-1 last:pb-8",
                    index < sections.length - 1 && "border-b border-border/60",
                  )}
                >
                  {section.content}
                </div>
              ))}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
