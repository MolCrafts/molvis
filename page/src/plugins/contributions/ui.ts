import type {
  ModePanelSpec,
  ModeTabSpec,
  PluginAnalysisSpec,
  PluginCacheSpec,
  PluginDialogSpec,
  PluginPanelSpec,
  SettingsSectionSpec,
  ToolbarActionSpec,
} from "../types";
import { ContributionStore } from "./store";

export const toolbarActionStore = new ContributionStore<ToolbarActionSpec>();
export const pluginCacheStore = new ContributionStore<PluginCacheSpec>();
export const settingsSectionStore =
  new ContributionStore<SettingsSectionSpec>();
export const analysisStore = new ContributionStore<PluginAnalysisSpec>();
export const modeTabStore = new ContributionStore<ModeTabSpec>();
export const dialogStore = new ContributionStore<PluginDialogSpec>();
export const panelStore = new ContributionStore<PluginPanelSpec>();

/** Keyed as `${mode}::${panelId}`. */
export const modePanelStore = new ContributionStore<
  ModePanelSpec & { mode: string }
>();

export function registerToolbarAction(spec: ToolbarActionSpec): () => void {
  return toolbarActionStore.set(spec.id, spec);
}

export function registerPluginCache(spec: PluginCacheSpec): () => void {
  return pluginCacheStore.set(spec.id, spec);
}

export function registerSettingsSection(spec: SettingsSectionSpec): () => void {
  return settingsSectionStore.set(spec.id, spec);
}

export function registerAnalysis(spec: PluginAnalysisSpec): () => void {
  return analysisStore.set(spec.id, spec);
}

export function registerModePanel(
  mode: string,
  spec: ModePanelSpec,
): () => void {
  const key = `${mode}::${spec.id}`;
  return modePanelStore.set(key, { ...spec, mode });
}

export function registerModeTab(spec: ModeTabSpec): () => void {
  return modeTabStore.set(spec.mode, spec);
}

export function registerDialog(spec: PluginDialogSpec): () => void {
  return dialogStore.set(spec.id, spec);
}

export function registerPanel(spec: PluginPanelSpec): () => void {
  return panelStore.set(spec.id, spec);
}

export function listModePanels(
  mode: string,
): Array<ModePanelSpec & { mode: string }> {
  return modePanelStore
    .list()
    .filter((p) => p.mode === mode)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

export function listModeTabs(): ModeTabSpec[] {
  return modeTabStore
    .list()
    .slice()
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

export function listBottomPanels(): PluginPanelSpec[] {
  return panelStore
    .list()
    .filter((p) => p.position === "bottom")
    .slice()
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}
