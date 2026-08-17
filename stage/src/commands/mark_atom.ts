/**
 * mark_atom / unmark_atom — first-class commands for marking atoms.
 *
 * A "mark" is a composite annotation (shape + optional label) that pins to an
 * atom and follows it across trajectory frames. Stored internally in
 * `OverlayManager` alongside arrows and text labels, but exposed as its own
 * domain-level command pair so callers think in terms of "mark this atom",
 * not "add an overlay of type mark_atom".
 *
 * Undo symmetry: mark_atom ↔ unmark_atom. The overlay instance is carried
 * as a snapshot across the pair so redo reinstates the exact same object.
 */

import type { MolvisApp } from "../app";
import type { MarkAtomContext } from "../overlays/mark_atom";
import { MarkAtomOverlay } from "../overlays/mark_atom";
import type { MarkAtomProps } from "../overlays/types";
import { Command, command } from "./base";

/**
 * Resolve the rendered atom radius and current world position from the
 * scene's meta registry. The registry is kept in sync with the active
 * frame by the artist, and its AtomSource re-fetches block handles
 * lazily, so this call reads a consistent snapshot even after WASM-side
 * handle-version bumps (e.g. from set_frame_labels → with_frame_mut).
 *
 * Throws when the anchor id cannot be resolved — mark_atom is an atom-
 * anchored overlay, so an invalid id is a programming error, not a
 * degradable condition.
 */
function resolveAnchorContext(
  app: MolvisApp,
  anchorAtomId: number,
): MarkAtomContext {
  const meta = app.world.sceneIndex.metaRegistry.atoms.getMeta(anchorAtomId);
  if (!meta) {
    throw new Error(
      `mark_atom: no atom with id ${anchorAtomId} in the current scene`,
    );
  }
  if (!meta.element) {
    throw new Error(
      `mark_atom: atom ${anchorAtomId} has no element; cannot resolve style`,
    );
  }
  return {
    atomRadius: app.styleManager.getAtomStyle(meta.element).radius,
    initialPosition: [meta.position.x, meta.position.y, meta.position.z],
  };
}

// ── mark_atom ────────────────────────────────────────────────────────────────

/**
 * Mark a specific atom with a halo and/or a text label. The halo radius and
 * label font size are auto-sized from the atom's rendered radius by default.
 *
 * Identity is **always** by atom id. World coordinates are not accepted —
 * the mark must follow its atom across frame updates, which is impossible
 * if it were pinned to a coordinate.
 *
 * Usage:
 *   app.execute("mark_atom", { anchorAtomId: 0 })
 *   app.execute("mark_atom", { anchorAtomId: 3, label: { text: "*" } })
 *
 * Returns the created MarkAtomOverlay (use `.id` for later unmark/update).
 */
@command("mark_atom")
export class MarkAtomCommand extends Command<MarkAtomOverlay> {
  private readonly _props: MarkAtomProps;
  private _added: MarkAtomOverlay | null = null;

  constructor(app: MolvisApp, args: MarkAtomProps) {
    super(app);
    this._props = args;
  }

  do(): MarkAtomOverlay {
    const context = resolveAnchorContext(this.app, this._props.anchorAtomId);
    const overlay = MarkAtomOverlay.create(
      this.app.scene,
      this._props,
      this.app.overlayManager.labelTexture,
      context,
    );
    this._added = overlay;
    this.app.overlayManager.add(overlay);
    // Snap onto the current atom synchronously — `frame-rendered` may not
    // fire again on a static scene, in which case the mark would otherwise
    // sit at the seeded position instead of tracking the atom.
    this.app.syncAnchoredOverlay(overlay);
    this.app.events.emit("overlay-added", { overlay });
    return overlay;
  }

  undo(): UnmarkAtomCommand {
    if (!this._added) {
      throw new Error("Cannot undo mark_atom before the mark is created");
    }
    return new UnmarkAtomCommand(this.app, {
      id: this._added.id,
      _snapshot: this._added,
    });
  }
}

// ── unmark_atom ──────────────────────────────────────────────────────────────

/**
 * Remove a mark by id.
 * Usage: app.execute("unmark_atom", { id: "mark_atom_1" })
 *
 * No-ops silently if the id does not match a current mark, so callers can
 * use it defensively without a prior existence check.
 */
@command("unmark_atom")
export class UnmarkAtomCommand extends Command<void> {
  private readonly _id: string;
  private _snapshot: MarkAtomOverlay | null;

  constructor(
    app: MolvisApp,
    args: { id: string; _snapshot?: MarkAtomOverlay | null },
  ) {
    super(app);
    this._id = args.id;
    this._snapshot = args._snapshot ?? null;
  }

  do(): void {
    if (!this._snapshot) {
      const existing = this.app.overlayManager.get(this._id);
      if (existing instanceof MarkAtomOverlay) this._snapshot = existing;
    }
    this.app.overlayManager.remove(this._id);
    this.app.events.emit("overlay-removed", { id: this._id });
  }

  undo(): RemarkAtomCommand {
    if (!this._snapshot) {
      throw new Error("Cannot undo unmark_atom without a saved mark snapshot");
    }
    return new RemarkAtomCommand(this.app, this._snapshot);
  }
}

// ── Internal: re-add a previously removed mark (for redo of unmark) ──────────

/**
 * Re-adds an already-constructed MarkAtomOverlay object.
 * Not RPC-exposed — only reachable via UnmarkAtomCommand.undo().
 */
export class RemarkAtomCommand extends Command<MarkAtomOverlay> {
  constructor(
    app: MolvisApp,
    private readonly _overlay: MarkAtomOverlay,
  ) {
    super(app);
  }

  do(): MarkAtomOverlay {
    this.app.overlayManager.add(this._overlay);
    this.app.syncAnchoredOverlay(this._overlay);
    this.app.events.emit("overlay-added", { overlay: this._overlay });
    return this._overlay;
  }

  undo(): UnmarkAtomCommand {
    return new UnmarkAtomCommand(this.app, {
      id: this._overlay.id,
      _snapshot: this._overlay,
    });
  }
}
