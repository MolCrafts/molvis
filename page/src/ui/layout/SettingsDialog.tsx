import {
  CameraRegular as Camera,
  GridRegular as Grid3x3,
  DesktopRegular as Monitor,
  ColorRegular as Palette,
  PuzzlePieceRegular as Puzzle,
  SettingsRegular as Settings,
  PhoneRegular as Smartphone,
  SparkleRegular as Sparkles,
} from "@fluentui/react-icons";
import type { Molvis } from "@molcrafts/molvis-stage";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  IconAction,
  type SettingsNavEntry,
  SettingsSection,
  SettingsShell,
} from "@molcrafts/ui";
import type React from "react";
import { useMemo } from "react";

import { cn } from "@/lib/utils";
import {
  PluginsSection,
  usePluginRuntimeStates,
  usePluginSettingsSections,
} from "@/plugins";
import { AppearanceSection } from "./AppearanceSection";
import { AppSection } from "./AppSection";
import { CameraSection } from "./CameraSection";
import { GraphicsSection } from "./GraphicsSection";
import { GridSection } from "./GridSection";
import { StageStyleSection } from "./StageStyleSection";

interface SettingsDialogProps {
  app: Molvis | null;
}

type SettingsEntry = SettingsNavEntry & { order?: number };

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
        id: "app",
        label: "App",
        group: "general",
        icon: <Smartphone className="size-3.5" aria-hidden />,
        content: <AppSection sectionId="app" />,
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

  return (
    <Dialog modal={false}>
      <DialogTrigger asChild>
        <IconAction icon={<Settings />} label="Settings" />
      </DialogTrigger>
      <DialogContent
        className={cn(
          "flex h-[min(85vh,40rem)] w-full flex-col gap-0 overflow-hidden p-0",
          "max-w-[min(46rem,calc(100vw-2rem))] sm:max-w-[min(46rem,calc(100vw-2rem))]",
        )}
      >
        <DialogHeader className="shrink-0 border-b border-border px-5 py-3.5 pr-12">
          <DialogTitle>Settings</DialogTitle>
        </DialogHeader>
        <SettingsShell
          chrome="plain"
          entries={sections}
          defaultId="appearance"
          className="min-h-0 flex-1"
        />
      </DialogContent>
    </Dialog>
  );
};
