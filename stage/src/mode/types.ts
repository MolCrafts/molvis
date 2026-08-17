import type { AbstractMesh } from "@babylonjs/core";
import type { AtomMeta, BondMeta } from "../entity_source";

/**
 * What the pointer is over in the 3D scene, right now — the result of one
 * pick/raycast.
 *
 * A hit is transient and singular: hover, the target a click would act on,
 * what a context menu is about. It is not a selection. The committed
 * multi-select is `SelectionManager` / `SelectionMask` / `currentSelection`,
 * it survives pointer movement, and `highlighter` is what draws it — which
 * is why highlighting can be suppressed while the selection stays. A hit may
 * *lead* to a selection; it never is one.
 *
 * Named for its surface so it never collides with the 2D board's
 * `BoardHit`, which describes the same idea over graph indices.
 */
export type SceneHit =
  | {
      type: "atom";
      mesh: AbstractMesh;
      metadata: AtomMeta;
      thinInstanceIndex: number;
    }
  | {
      type: "bond";
      mesh: AbstractMesh;
      metadata: BondMeta;
      thinInstanceIndex: number;
    }
  | {
      type: "ribbon";
      mesh: AbstractMesh;
      chainId: string;
      resName: string;
      resSeq: number;
      residueIndex: number;
    }
  | {
      type: "empty";
    };

export interface BindingOption {
  text: string;
  value: string | number | boolean;
}

export interface BindingConfig {
  view?: "list" | "checkbox" | "slider" | "element-picker";
  label?: string;
  value: string | number | boolean;
  options?: BindingOption[];
  min?: number;
  max?: number;
  step?: number;
}

export interface BindingEvent {
  value: string | number | boolean;
}

/**
 * Menu item configuration for context menus.
 * Keep `title` to at most two words (readable on small canvases).
 */
export type MenuItem =
  | {
      type: "button";
      title: string;
      action: () => void;
      /** Show a check mark (toggle / radio). */
      checked?: boolean;
      /** Non-interactive, muted. */
      disabled?: boolean;
      /** Optional shortcut hint shown on the right (display only). */
      shortcut?: string;
    }
  | {
      type: "separator";
    }
  | {
      type: "folder";
      title: string;
      items: MenuItem[];
      disabled?: boolean;
    }
  | {
      type: "binding";
      bindingConfig: BindingConfig;
      action: (ev: BindingEvent) => void;
    };
