/**
 * Bridges core events to outbound JSON-RPC notifications on the
 * WebSocket bridge.
 *
 * The controller (Python / other languages) cares about changes that happen
 * inside the canvas: selection mutations, mode switches, frame navigation,
 * status messages. Each such change is pushed as a JSON-RPC notification
 * (`method: "event.*"`, no `id`) via `WebSocketBridge.sendEvent`.
 *
 * Lifecycle: `start()` registers listeners and immediately pushes an
 * initial `event.hello_state` snapshot so the controller's cache is seeded
 * before any subsequent event fires. `stop()` unregisters everything.
 * Both calls are idempotent.
 */

import type { MolvisApp } from "../app";
import type { WebSocketBridge } from "./ws_bridge";

export class EventForwarder {
  private unsubscribers: Array<() => void> = [];
  private started = false;

  constructor(
    private readonly bridge: WebSocketBridge,
    private readonly app: MolvisApp,
  ) {}

  start(): void {
    if (this.started) {
      return;
    }
    this.started = true;

    this.unsubscribers.push(
      this.app.world.selectionManager.on("selection-change", () => {
        this.pushSelectionChanged();
      }),
    );

    this.unsubscribers.push(
      this.app.events.on("mode-change", (mode) => {
        this.bridge.sendEvent("event.mode_changed", { mode });
      }),
    );

    this.unsubscribers.push(
      this.app.events.on("frame-change", (index) => {
        this.bridge.sendEvent("event.frame_changed", {
          index,
          total: this.app.system.trajectory?.length ?? 0,
        });
      }),
    );

    this.unsubscribers.push(
      this.app.events.on("status-message", ({ text, type }) => {
        this.bridge.sendEvent("event.status_message", { text, type });
      }),
    );

    this.pushHelloState();
  }

  stop(): void {
    if (!this.started) {
      return;
    }
    this.started = false;
    for (const unsub of this.unsubscribers) {
      unsub();
    }
    this.unsubscribers = [];
  }

  private pushSelectionChanged(): void {
    try {
      const meta = this.app.world.selectionManager.getSelectedMeta();
      this.bridge.sendEvent("event.selection_changed", {
        atom_ids: meta.atoms.atomId,
        bond_ids: meta.bonds.bondId,
      });
    } catch (err) {
      console.error("EventForwarder: failed to push selection", err);
    }
  }

  private pushHelloState(): void {
    try {
      const meta = this.app.world.selectionManager.getSelectedMeta();
      this.bridge.sendEvent("event.hello_state", {
        selection: {
          atom_ids: meta.atoms.atomId,
          bond_ids: meta.bonds.bondId,
        },
        mode: this.app.mode?.name ?? null,
        frame_index: this.app.currentFrame,
        total_frames: this.app.system.trajectory?.length ?? 0,
      });
    } catch (err) {
      console.error("EventForwarder: failed to push hello_state", err);
    }
  }
}
