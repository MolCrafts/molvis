/**
 * Overlay commands — undo/redo-able operations on the OverlayManager.
 *
 * These commands are registered with the @command decorator so they can be
 * invoked via app.execute("add_overlay", props) from TypeScript and Python.
 */

import type { MolvisApp } from "../app";
import { Arrow2DOverlay } from "../overlays/arrow2d";
import { Arrow3DOverlay } from "../overlays/arrow3d";
import { TextLabelOverlay } from "../overlays/text_label";
import type {
  Arrow2DProps,
  Arrow3DProps,
  Overlay,
  TextLabelProps,
  VectorFieldProps,
} from "../overlays/types";
import { VectorFieldOverlay } from "../overlays/vector_field";
import { Command, command } from "./base";

// ── Factory helper ────────────────────────────────────────────────────────────
//
// `add_overlay` handles the generic decoration overlays. Atom marks have their
// own first-class commands — see commands/mark_atom.ts. Keeping those out of
// this union means a caller who wants to mark an atom cannot accidentally
// reach for `add_overlay({ type: "mark_atom" })`: there is one door per concept.

type OverlaySpec =
  | ({ type: "arrow3d" } & Arrow3DProps)
  | ({ type: "arrow2d" } & Arrow2DProps)
  | ({ type: "text_label" } & TextLabelProps)
  | ({ type: "vector_field" } & VectorFieldProps);

function buildOverlay(app: MolvisApp, spec: OverlaySpec): Overlay {
  const scene = app.scene;
  switch (spec.type) {
    case "arrow3d":
      return Arrow3DOverlay.create(scene, spec);
    case "arrow2d":
      return Arrow2DOverlay.create(scene, spec);
    case "text_label":
      return TextLabelOverlay.create(
        scene,
        spec,
        app.overlayManager.labelTexture,
      );
    case "vector_field":
      return VectorFieldOverlay.create(scene, spec);
  }
}

// ── AddOverlayCommand ─────────────────────────────────────────────────────────

/**
 * Add an overlay. Undo removes it.
 * Usage: app.execute("add_overlay", { type: "arrow3d", from: [...], to: [...] })
 */
@command("add_overlay")
export class AddOverlayCommand extends Command<Overlay> {
  private readonly _spec: OverlaySpec;
  private _added: Overlay | null = null;

  constructor(app: MolvisApp, args: OverlaySpec) {
    super(app);
    this._spec = args;
  }

  do(): Overlay {
    const overlay = buildOverlay(this.app, this._spec);
    this._added = overlay;
    this.app.overlayManager.add(overlay);
    // Snap onto the anchor atom (if any) synchronously — see MarkAtomCommand.
    this.app.syncAnchoredOverlay(overlay);
    this.app.events.emit("overlay-added", { overlay });
    return overlay;
  }

  undo(): RemoveOverlayCommand {
    if (!this._added) {
      throw new Error("Cannot undo add_overlay before the overlay is created");
    }
    return new RemoveOverlayCommand(this.app, {
      id: this._added.id,
      _snapshot: this._added,
    });
  }
}

// ── RemoveOverlayCommand ──────────────────────────────────────────────────────

/**
 * Remove an overlay by id. Undo re-adds the overlay.
 * Usage: app.execute("remove_overlay", { id: "arrow3d_1" })
 */
@command("remove_overlay")
export class RemoveOverlayCommand extends Command<void> {
  private readonly _id: string;
  private _snapshot: Overlay | null;

  constructor(
    app: MolvisApp,
    args: { id: string; _snapshot?: Overlay | null },
  ) {
    super(app);
    this._id = args.id;
    this._snapshot = args._snapshot ?? null;
  }

  do(): void {
    if (!this._snapshot) {
      this._snapshot = this.app.overlayManager.get(this._id) ?? null;
    }
    this.app.overlayManager.remove(this._id);
    this.app.events.emit("overlay-removed", { id: this._id });
  }

  undo(): AddOverlaySnapshotCommand {
    if (!this._snapshot) {
      throw new Error(
        "Cannot undo remove_overlay without a saved overlay snapshot",
      );
    }
    return new AddOverlaySnapshotCommand(this.app, this._snapshot);
  }
}

// ── AddOverlaySnapshotCommand (internal, for redo) ────────────────────────────

/**
 * Re-adds an already-constructed overlay object (used by undo of Remove).
 * Not exposed as an RPC command.
 */
export class AddOverlaySnapshotCommand extends Command<Overlay> {
  constructor(
    app: MolvisApp,
    private readonly _overlay: Overlay,
  ) {
    super(app);
  }

  do(): Overlay {
    this.app.overlayManager.add(this._overlay);
    this.app.syncAnchoredOverlay(this._overlay);
    this.app.events.emit("overlay-added", { overlay: this._overlay });
    return this._overlay;
  }

  undo(): RemoveOverlayCommand {
    return new RemoveOverlayCommand(this.app, {
      id: this._overlay.id,
      _snapshot: this._overlay,
    });
  }
}

// ── UpdateOverlayCommand ──────────────────────────────────────────────────────

/**
 * Update props on an existing overlay. Undo restores previous props.
 * Usage: app.execute("update_overlay", { id: "arrow3d_1", patch: { color: "#00ff00" } })
 */
@command("update_overlay")
export class UpdateOverlayCommand extends Command<void> {
  private readonly _id: string;
  private readonly _patch: Record<string, unknown>;
  private _prevProps: Record<string, unknown> | null = null;

  constructor(
    app: MolvisApp,
    args: {
      id: string;
      patch: Record<string, unknown>;
      _prevProps?: Record<string, unknown>;
    },
  ) {
    super(app);
    this._id = args.id;
    this._patch = args.patch;
    this._prevProps = args._prevProps ?? null;
  }

  do(): void {
    const overlay = this.app.overlayManager.get(this._id);
    if (!overlay) return;
    // Save current props for undo (only for overlay types that expose props)
    const typed = overlay as unknown as { props?: Record<string, unknown> };
    if (typed.props && !this._prevProps) {
      this._prevProps = { ...typed.props };
    }
    const updatable = overlay as unknown as {
      update(patch: Record<string, unknown>): void;
    };
    updatable.update(this._patch);
    // If the patch changed an atom anchor, resync immediately so the
    // overlay snaps to the new atom rather than waiting on a render.
    this.app.syncAnchoredOverlay(overlay);
    this.app.events.emit("overlay-changed", { overlay });
  }

  undo(): UpdateOverlayCommand {
    return new UpdateOverlayCommand(this.app, {
      id: this._id,
      patch: this._prevProps ?? {},
    });
  }
}
