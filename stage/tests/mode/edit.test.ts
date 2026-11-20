import {
  type AbstractMesh,
  type PointerInfo,
  Vector2,
  Vector3,
} from "@babylonjs/core";
import type { Frame } from "@molcrafts/molvis-core/molrs";
import { describe, expect, it, rstest } from "@rstest/core";
import type { MolvisApp } from "../../src/app";
import type { Command } from "../../src/commands/base";
import { EditMode } from "../../src/mode/edit";
import type { SceneHit } from "../../src/mode/types";

rstest.mock("../../src/mode/base", () => {
  return {
    ModeType: { Edit: "edit" },
    BaseMode: class {
      _pointer_down_xy = new Vector2();
      _pointer_up_xy = new Vector2();
      constructor(
        _name: string,
        readonly app: EditFixture,
      ) {}
      get world() {
        return this.app.world;
      }
      get _is_dragging() {
        return (
          this._pointer_up_xy.subtract(this._pointer_down_xy).length() > 0.2
        );
      }
      get_pointer_xy() {
        return new Vector2(
          this.world.scene.pointerX,
          this.world.scene.pointerY,
        );
      }
      async _on_pointer_down() {
        this._pointer_down_xy = this.get_pointer_xy();
      }
      async _on_pointer_up() {
        this._pointer_up_xy = this.get_pointer_xy();
      }
      async _on_pointer_move() {}
      async pickHit() {
        return this.app.hit;
      }
      projectPointerOnScreenPlane() {
        return this.app.projected.clone();
      }
      isPointerOnWorkbenchChrome() {
        return false;
      }
      isPointerNearCanvasSideEdge() {
        return false;
      }
      start() {}
      finish() {}
    },
  };
});
rstest.mock("../../src/ui/menus/controller", () => ({
  ContextMenuController: class {},
}));
rstest.mock("../../src/mode/preview_impostor", () => ({
  PreviewManager: class {
    constructor(private readonly app: EditFixture) {}
    showAtom() {
      this.app.previews.push("atom");
    }
    showBond() {
      this.app.previews.push("bond");
    }
    hideAtom() {}
    hideBond() {}
    clear() {}
  },
}));

/** Only EditMode runs; camera, picker, preview renderer and artist are fakes. */
class EditFixture {
  readonly canvas = {};
  readonly commands: Command<unknown>[] = [];
  readonly previews: string[] = [];
  readonly changes: Array<{
    kind: string;
    atomId?: number;
    atomId1?: number;
    atomId2?: number;
  }> = [];
  hit: SceneHit | null = null;
  projected = new Vector3(1.5, 0, 0);
  detached = 0;
  attached = 0;
  world = {
    scene: {
      pointerX: 100,
      pointerY: 100,
      getEngine: () => ({ getRenderingCanvas: () => this.canvas }),
    },
    camera: {
      detachControl: () => {
        this.detached++;
      },
      attachControl: () => {
        this.attached++;
      },
    },
    sceneIndex: {
      getNextAtomId: () => 42,
      getNextBondId: () => 5,
      getMeta: (meshId: number) => ({
        type: "atom",
        atomId: meshId === 8 ? 41 : 43,
        element: "C",
        position: { x: meshId === 8 ? 0 : 2, y: 0, z: 0 },
      }),
    },
  };
  artist = {
    drawAtom: async (_position: Vector3, options: { atomId: number }) => {
      this.changes.push({ kind: "atom", atomId: options.atomId });
      return { atomId: options.atomId, meshId: 1 };
    },
    drawBond: async (
      _start: Vector3,
      _end: Vector3,
      options: { atomId1: number; atomId2: number },
    ) => {
      this.changes.push({
        kind: "bond",
        atomId1: options.atomId1,
        atomId2: options.atomId2,
      });
      return { bondId: 5, meshId: 2 };
    },
    deleteAtom: () => {
      this.changes.pop();
    },
    deleteBond: () => {
      this.changes.pop();
    },
  };
  styleManager = { getAtomStyle: () => ({ color: "#555555" }) };
  commandManager = {
    execute: (command: Command<unknown>) => {
      this.commands.push(command);
    },
  };
  readonly mode = new EditMode(this as unknown as MolvisApp);
  pointer(x: number, y: number): PointerInfo {
    this.world.scene.pointerX = x;
    this.world.scene.pointerY = y;
    return {
      event: { target: this.canvas, button: 0, clientX: x, clientY: y },
    } as unknown as PointerInfo;
  }
  atom(meshId: number): SceneHit {
    return {
      type: "atom",
      mesh: { uniqueId: meshId } as AbstractMesh,
      thinInstanceIndex: 0,
      metadata: this.world.sceneIndex.getMeta(meshId),
    } as SceneHit;
  }
}

describe("EditMode pointer gestures", () => {
  it("Escape cancels an atom drag before release and restores camera control", async () => {
    const fixture = new EditFixture();
    fixture.hit = fixture.atom(8);
    await fixture.mode._on_pointer_down(fixture.pointer(100, 100));
    fixture.hit = null;
    await fixture.mode._on_pointer_move(fixture.pointer(160, 120));
    (
      fixture.mode as unknown as { _on_press_escape(): void }
    )._on_press_escape();
    await fixture.mode._on_pointer_up(fixture.pointer(160, 120));
    expect(fixture.commands).toEqual([]);
    expect(fixture.attached).toBe(1);
  });

  it("leaving Edit during an atom drag restores camera control", async () => {
    const fixture = new EditFixture();
    fixture.hit = fixture.atom(8);
    await fixture.mode._on_pointer_down(fixture.pointer(100, 100));
    fixture.mode.finish();
    expect(fixture.attached).toBe(1);
  });
  it("keeps the camera attached and draws nothing for an empty-space drag", async () => {
    const fixture = new EditFixture();
    await fixture.mode._on_pointer_down(fixture.pointer(100, 100));
    await fixture.mode._on_pointer_move(fixture.pointer(160, 120));
    await fixture.mode._on_pointer_up(fixture.pointer(160, 120));
    expect(fixture.detached).toBe(0);
    expect(fixture.previews).toEqual([]);
    expect(fixture.commands).toEqual([]);
  });

  it("does not place an atom when an orbit drag returns to its starting point", async () => {
    const fixture = new EditFixture();
    await fixture.mode._on_pointer_down(fixture.pointer(100, 100));
    await fixture.mode._on_pointer_move(fixture.pointer(160, 120));
    await fixture.mode._on_pointer_up(fixture.pointer(100, 100));
    expect(fixture.commands).toEqual([]);
  });

  it("still places a lone atom for an empty-space click", async () => {
    const fixture = new EditFixture();
    await fixture.mode._on_pointer_down(fixture.pointer(100, 100));
    await fixture.mode._on_pointer_up(fixture.pointer(100, 100));
    expect(fixture.commands).toHaveLength(1);
    await fixture.commands[0].do();
    expect(fixture.changes).toEqual([{ kind: "atom", atomId: 42 }]);
  });

  it("previews and creates one atom plus its bond as a single reversible edit", async () => {
    const fixture = new EditFixture();
    fixture.hit = fixture.atom(8);
    await fixture.mode._on_pointer_down(fixture.pointer(100, 100));
    expect(fixture.detached).toBe(1);
    fixture.hit = null;
    await fixture.mode._on_pointer_move(fixture.pointer(160, 120));
    expect(fixture.previews).toEqual(["atom", "bond"]);
    await fixture.mode._on_pointer_up(fixture.pointer(160, 120));
    expect(fixture.commands).toHaveLength(1);
    await fixture.commands[0].do();
    expect(fixture.changes).toEqual([
      { kind: "atom", atomId: 42 },
      { kind: "bond", atomId1: 41, atomId2: 42 },
    ]);
    await fixture.commands[0].undo();
    expect(fixture.changes).toEqual([]);
    expect(fixture.attached).toBe(1);
  });

  it("connects an existing target atom without creating an extra atom", async () => {
    const fixture = new EditFixture();
    fixture.hit = fixture.atom(8);
    await fixture.mode._on_pointer_down(fixture.pointer(100, 100));
    fixture.hit = fixture.atom(9);
    await fixture.mode._on_pointer_move(fixture.pointer(160, 120));
    await fixture.mode._on_pointer_up(fixture.pointer(160, 120));
    await fixture.commands[0].do();
    expect(fixture.changes).toEqual([
      { kind: "bond", atomId1: 41, atomId2: 43 },
    ]);
  });

  it("allows orbiting with a molecule stamp armed without placing a copy", async () => {
    const fixture = new EditFixture();
    fixture.mode.pendingMolecule = { free: () => {} } as Frame;
    await fixture.mode._on_pointer_down(fixture.pointer(100, 100));
    await fixture.mode._on_pointer_move(fixture.pointer(160, 120));
    await fixture.mode._on_pointer_up(fixture.pointer(160, 120));
    expect(fixture.detached).toBe(0);
    expect(fixture.commands).toEqual([]);
  });
});
