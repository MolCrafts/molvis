/**
 * Workbench L2 capabilities — named features enabled after L1 stage is up.
 *
 * Heavy capabilities should `import()` inside `enable`. Outline is light but
 * still loads `buildStructureOutline` via dynamic import so the L0 entry never
 * touches stage statically.
 */

import type { Molvis } from "@molcrafts/molvis-stage";
import type { StructureOutlineNode } from "../protocol";
import type { HostApi } from "../webview/errorBoundary";

export type CapabilityId = "outline" | "settings";

export type CapabilityStatus = "loading" | "ready" | "error" | "disabled";

export interface CapabilityContext {
  app: Molvis;
  host: HostApi;
}

export interface Capability {
  id: CapabilityId;
  enable(ctx: CapabilityContext): void | Promise<void>;
  disable(ctx: CapabilityContext): void;
}

export interface CapabilityRegistry {
  enable(id: string): Promise<void>;
  disable(id: string): void;
  isEnabled(id: string): boolean;
  dispose(): void;
}

function postState(
  host: HostApi,
  id: string,
  status: CapabilityStatus,
  message?: string,
): void {
  host.postMessage({
    type: "capabilityState",
    id,
    status,
    ...(message ? { message } : {}),
  });
}

function createOutlineCapability(): Capability {
  let onFrame: (() => void) | undefined;

  return {
    id: "outline",
    async enable(ctx) {
      const { buildStructureOutline } = await import("@molcrafts/molvis-stage");

      const publish = (): void => {
        const frame = ctx.app.system.frame;
        if (!frame) {
          ctx.host.postMessage({
            type: "structureOutline",
            outline: { roots: [] },
          });
          return;
        }
        const outline = buildStructureOutline(frame);
        ctx.host.postMessage({
          type: "structureOutline",
          outline: {
            roots: outline.roots as StructureOutlineNode[],
          },
        });
      };

      onFrame = () => {
        publish();
      };
      ctx.app.events.on("frame-rendered", onFrame);
      publish();
      postState(ctx.host, "outline", "ready");
    },
    disable(ctx) {
      if (onFrame) {
        ctx.app.events.off("frame-rendered", onFrame);
        onFrame = undefined;
      }
      ctx.host.postMessage({
        type: "structureOutline",
        outline: { roots: [] },
      });
      postState(ctx.host, "outline", "disabled");
    },
  };
}

/** Settings are applied via host `applySettings`; this marks the surface ready. */
function createSettingsCapability(): Capability {
  return {
    id: "settings",
    enable(ctx) {
      postState(ctx.host, "settings", "ready");
    },
    disable(ctx) {
      postState(ctx.host, "settings", "disabled");
    },
  };
}

const CATALOG: Record<CapabilityId, () => Capability> = {
  outline: createOutlineCapability,
  settings: createSettingsCapability,
};

export function createCapabilityRegistry(
  ctx: CapabilityContext,
): CapabilityRegistry {
  const enabled = new Map<string, Capability>();

  return {
    async enable(id: string) {
      if (enabled.has(id)) return;
      const factory = CATALOG[id as CapabilityId];
      if (!factory) {
        postState(ctx.host, id, "error", `Unknown capability: ${id}`);
        return;
      }
      postState(ctx.host, id, "loading");
      const cap = factory();
      try {
        await cap.enable(ctx);
        enabled.set(id, cap);
      } catch (error) {
        const text = error instanceof Error ? error.message : String(error);
        postState(ctx.host, id, "error", text);
      }
    },
    disable(id: string) {
      const cap = enabled.get(id);
      if (!cap) return;
      cap.disable(ctx);
      enabled.delete(id);
    },
    isEnabled(id: string) {
      return enabled.has(id);
    },
    dispose() {
      for (const [, cap] of [...enabled]) {
        try {
          cap.disable(ctx);
        } catch {
          /* ignore */
        }
      }
      enabled.clear();
    },
  };
}

/** Default capabilities enabled when a Workbench panel starts. */
export const DEFAULT_WORKBENCH_CAPABILITIES: readonly CapabilityId[] = [
  "outline",
  "settings",
];
