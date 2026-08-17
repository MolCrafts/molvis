import {
  commands,
  type Modifier,
  ModifierRegistry,
  type Molvis,
  namespacePluginId,
  type Overlay,
  type PluginModeFactory,
  registerRpcExtensionHandler,
} from "@molcrafts/molvis-stage";
import { openPluginDialog } from "../contributions/dialog_host";
import {
  PLUGIN_MODIFIER_TYPE_ID,
  registerModifierPanel,
} from "../contributions/modifier_panels";
import {
  registerAnalysis,
  registerDialog,
  registerModePanel,
  registerModeTab,
  registerPanel,
  registerPluginCache,
  registerSettingsSection,
  registerToolbarAction,
} from "../contributions/ui";
import { pluginStorageNamespace } from "../storage";
import type {
  CommandToolbarOptions,
  Disposer,
  ModePanelSpec,
  PluginAnalysisSpec,
  PluginAPI,
  PluginCacheSpec,
  PluginCommandFn,
  PluginDialogSpec,
  PluginLogger,
  PluginPanelSpec,
  PluginRpcHandler,
  SettingsSectionSpec,
} from "../types";

export interface CreatedPluginAPI {
  api: PluginAPI;
  disposeAll: () => void;
}

function makeLogger(pluginId: string): PluginLogger {
  const tag = `[plugin:${pluginId}]`;
  return {
    info: (...args) => console.info(tag, ...args),
    warn: (...args) => console.warn(tag, ...args),
    error: (...args) => console.error(tag, ...args),
  };
}

function tagModifier(modifier: Modifier, kind: string): Modifier {
  Object.defineProperty(modifier, PLUGIN_MODIFIER_TYPE_ID, {
    value: kind,
    enumerable: false,
    configurable: true,
  });
  return modifier;
}

/**
 * Namespace every contribution id under `plugin.<pluginId>.`.
 *
 * Delegates to the engine's single implementation so the host and the stage
 * mode panel cannot disagree about the scheme. Do not reintroduce a local
 * "already namespaced?" heuristic: the previous one treated any dotted id as
 * pre-namespaced, so two plugins both registering, say, `settings.about`
 * silently shared one id.
 */
function ns(pluginId: string, id: string): string {
  return namespacePluginId(pluginId, id);
}

export function createPluginAPI(
  app: Molvis,
  pluginId: string,
): CreatedPluginAPI {
  const disposers: Disposer[] = [];
  const track = (d: Disposer): void => {
    disposers.push(d);
  };

  const api: PluginAPI = {
    app,
    pluginId,
    log: makeLogger(pluginId),
    storage: pluginStorageNamespace(pluginId),

    modifiers: {
      register(kind, category, factory, options) {
        // ModifierRegistry.register silently replaces a same-named entry, so
        // an un-namespaced `kind` let one plugin clobber another's modifier
        // and property panel with no warning.
        const namespaced = ns(pluginId, kind);
        const wrapped = () => tagModifier(factory(), namespaced);
        ModifierRegistry.register(namespaced, category, wrapped);
        track(() => {
          ModifierRegistry.unregister(namespaced);
        });
        if (options?.panel) {
          track(registerModifierPanel(namespaced, options.panel));
        }
      },
    },

    modes: {
      register(id: string, factory: PluginModeFactory, options) {
        const mm = app.modeManager;
        if (!mm) {
          throw new Error("Cannot register mode on a headless app");
        }
        const namespaced = ns(pluginId, id);
        track(mm.registerPluginMode(namespaced, factory));
        if (options?.panel) {
          const panelId = ns(pluginId, options.panel.id);
          track(
            registerModePanel(namespaced, { ...options.panel, id: panelId }),
          );
        }
        if (options?.tab) {
          track(
            registerModeTab({
              mode: namespaced,
              label: options.tab.label,
              icon: options.tab.icon,
              order: options.tab.order,
            }),
          );
        }
      },
      registerToolsPanel(mode: string, spec: ModePanelSpec) {
        track(registerModePanel(mode, { ...spec, id: ns(pluginId, spec.id) }));
      },
    },

    analysis: {
      register(spec: PluginAnalysisSpec) {
        const id = ns(pluginId, spec.id);
        track(registerAnalysis({ ...spec, id }));
      },
    },

    commands: {
      register<A, R>(
        name: string,
        fn: PluginCommandFn<A, R>,
        options?: { toolbar?: CommandToolbarOptions },
      ) {
        const fullName = ns(pluginId, name);
        commands.register(fullName, fn as PluginCommandFn);
        track(() => {
          commands.unregister(fullName);
        });
        if (options?.toolbar) {
          const tb = options.toolbar;
          const toolbarId = tb.id ? ns(pluginId, tb.id) : `${fullName}.toolbar`;
          const args = tb.args;
          const opensDialog = tb.opensDialog
            ? ns(pluginId, tb.opensDialog)
            : undefined;
          track(
            registerToolbarAction({
              id: toolbarId,
              label: tb.label,
              icon: tb.icon,
              order: tb.order,
              isVisible: tb.isVisible,
              opensDialog,
              onClick: (a) => {
                void fn(a, args as A);
                if (opensDialog) {
                  openPluginDialog(opensDialog);
                }
              },
            }),
          );
        }
      },
    },

    dialogs: {
      register(spec: PluginDialogSpec) {
        const id = ns(pluginId, spec.id);
        track(registerDialog({ ...spec, id }));
      },
    },

    panels: {
      register(spec: PluginPanelSpec) {
        if (spec.position !== "bottom") {
          throw new Error(
            `Plugin panel position '${String(spec.position)}' is not supported (v1: bottom only)`,
          );
        }
        const id = ns(pluginId, spec.id);
        track(registerPanel({ ...spec, id }));
      },
    },

    overlays: {
      add(overlay: Overlay) {
        app.overlayManager.add(overlay);
        track(() => {
          try {
            app.overlayManager.remove(overlay.id);
          } catch {
            /* already gone */
          }
        });
      },
    },

    settings: {
      registerSection(spec: SettingsSectionSpec) {
        const id = ns(pluginId, spec.id);
        track(registerSettingsSection({ ...spec, id }));
      },
    },

    caches: {
      register(spec: PluginCacheSpec) {
        const id = ns(pluginId, spec.id);
        track(registerPluginCache({ ...spec, id }));
      },
    },

    rpc: {
      registerMethod(name: string, handler: PluginRpcHandler) {
        const fullName = ns(pluginId, name);
        track(
          registerRpcExtensionHandler(fullName, (params, buffers) =>
            handler(params, { app, buffers }),
          ),
        );
      },
    },
  };

  return {
    api,
    disposeAll: () => {
      for (let i = disposers.length - 1; i >= 0; i--) {
        try {
          disposers[i]();
        } catch (err) {
          console.error(`[plugin:${pluginId}] dispose failed`, err);
        }
      }
      disposers.length = 0;
    },
  };
}
