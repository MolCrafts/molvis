/**
 * Contract lock for the edit-pool position write path: where a moved atom's
 * coordinates land in the impostor buffers, which buffers that marks dirty, and
 * the order the one-shot upload tick runs its three collaborators in.
 *
 * Goldens are literals, hand-derived from the buffer layout — no tool, no
 * oracle, no third-party numbers:
 *
 * - `matrix` is the Babylon thin-instance world matrix, stride 16, column-major;
 *   slots 12/13/14 are the translation column, 0/5/10 the scale.
 * - `instanceData` is stride 4, packed `(x, y, z, radius)`.
 * - The atom below is logical id 3 in a frame segment of 8 (identity mapping),
 *   so its render row is 3: matrix slots `3*16+12..14` = 60/61/62 and
 *   instanceData slots `3*4+0..2` = 12/13/14.
 * - 1.5, -2.25 and 0.5 are exactly representable in float32, so the write is
 *   compared for exact equality rather than with a tolerance.
 * - A position write is a partial upload: exactly `matrix` and `instanceData`
 *   are marked dirty. Marking everything dirty re-uploads the color buffers and
 *   wipes the selection highlight mid-drag, which is the bug this locks out.
 * - `flush()` paints, then flags unsaved, then rebuilds the highlight. The
 *   order is semantic: bond rebuilds dirty the color buffers, so a highlight
 *   rebuilt before the upload renders a drag as a deselect.
 *
 * Run with the repo TS runner: `node regressions/optimize-staging-01-positions.ts`
 * after `npm run build:stage`.
 *
 * `edit_pool_positions` is a stage-internal seam and by invariant is on no
 * public barrel, so it is pinned at its build-output deep path — same
 * convention as `regressions/worker-catalog-dispatch-03-runner.ts`. Its runtime
 * closure pulls in the bond geometry kernel (and through it `@babylonjs/core`,
 * the module's own declared dependency); no engine, canvas or scene is created
 * here, no WebAssembly (WASM) module is instantiated, no molrs call is made and
 * no external process runs. Every collaborator below is a plain object.
 */
import {
  EditPoolPositions,
  ScenePaintTick,
} from "../stage/dist/edit_pool_positions.js";

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}

/**
 * The collaborator surfaces, taken from the classes themselves — that keeps
 * this script's import list at exactly one module.
 */
type EditPoolScene = ConstructorParameters<typeof EditPoolPositions>[0];
type BondRadiusSource = ConstructorParameters<typeof EditPoolPositions>[1];
type SceneMeshPainter = ConstructorParameters<typeof ScenePaintTick>[0];
type HighlightInvalidator = ConstructorParameters<typeof ScenePaintTick>[2];
type BondPlaneAxisArgs = Parameters<EditPoolScene["bondPlaneAxis"]>;
type UpdateAtomArgs = Parameters<EditPoolScene["updateAtom"]>;
type ImpostorBuffer = { data: Float32Array; stride: number };

const MATRIX_STRIDE = 16;
const INSTANCE_DATA_STRIDE = 4;
const CAPACITY = 16;
const ATOM_MESH_ID = 11;
/** Frame atoms occupy rows 0..7; ids beyond that live in the edit pool. */
const FRAME_OFFSET = 8;
const MOVED_ATOM_ID = 3;

/**
 * The impostor buffers of one mesh layer, with the real id -> render row
 * resolution: frame segment is the identity, edit-pool ids go through the edit
 * table plus the frame offset.
 */
class FakeImpostorState {
  mesh: { uniqueId: number };
  buffers: Map<string, ImpostorBuffer>;
  frameOffset: number;
  idToIndex: Map<number, number>;
  dirtied: string[];

  constructor(uniqueId: number, frameOffset: number) {
    this.mesh = { uniqueId };
    this.buffers = new Map<string, ImpostorBuffer>([
      [
        "matrix",
        {
          data: new Float32Array(CAPACITY * MATRIX_STRIDE),
          stride: MATRIX_STRIDE,
        },
      ],
      [
        "instanceData",
        {
          data: new Float32Array(CAPACITY * INSTANCE_DATA_STRIDE),
          stride: INSTANCE_DATA_STRIDE,
        },
      ],
    ]);
    this.frameOffset = frameOffset;
    this.idToIndex = new Map<number, number>();
    this.dirtied = [];
  }

  renderIndicesForLogicalId(id: number): number[] {
    if (id < this.frameOffset) return [id];
    const editIndex = this.idToIndex.get(id);
    return editIndex === undefined ? [] : [editIndex + this.frameOffset];
  }

  markDirty(...names: string[]): void {
    this.dirtied.push(...names);
  }

  buffer(name: string): Float32Array {
    const desc = this.buffers.get(name);
    if (!desc) throw new Error(`buffer ${name} missing from the fake`);
    return desc.data;
  }
}

/** The scene registry surface a position write drives; nothing more. */
class FakeScene implements EditPoolScene {
  atomState: FakeImpostorState;
  updateAtomCalls: UpdateAtomArgs[];
  order: string[];
  meshRegistry: EditPoolScene["meshRegistry"];
  metaRegistry: EditPoolScene["metaRegistry"];
  topology: EditPoolScene["topology"];

  constructor(atomState: FakeImpostorState, order: string[]) {
    this.atomState = atomState;
    this.updateAtomCalls = [];
    this.order = order;
    this.meshRegistry = {
      getAtomState: () => this.atomState,
      // No bond layer: this scenario moves one atom and rebuilds no bonds.
      getBondState: () => null,
    };
    this.metaRegistry = {
      atoms: { getMeta: () => null },
      bonds: { getMeta: () => null },
    };
    this.topology = { incident: () => [], endpoints: () => undefined };
  }

  updateAtom(...args: UpdateAtomArgs): void {
    this.updateAtomCalls.push(args);
  }

  updateBond(): void {
    throw new Error("this scenario rebuilds no bond");
  }

  bondPlaneAxis(...args: BondPlaneAxisArgs): void {
    args[5].set(0, 0, 1);
  }

  markAllUnsaved(): void {
    this.order.push("markAllUnsaved");
  }
}

class FakeBondStyles implements BondRadiusSource {
  getBondStyle(): { radius: number } {
    return { radius: 0.15 };
  }
}

class FakePainter implements SceneMeshPainter {
  order: string[];

  constructor(order: string[]) {
    this.order = order;
  }

  applySceneIndexToMeshes(): void {
    this.order.push("applySceneIndexToMeshes");
  }
}

class FakeHighlighter implements HighlightInvalidator {
  order: string[];

  constructor(order: string[]) {
    this.order = order;
  }

  invalidateAndRebuild(): void {
    this.order.push("invalidateAndRebuild");
  }
}

// --- writeAtom: the literals land in the translation and xyz slots ----------

const order: string[] = [];
const atomState = new FakeImpostorState(ATOM_MESH_ID, FRAME_OFFSET);
const scene = new FakeScene(atomState, order);
const positions = new EditPoolPositions(scene, new FakeBondStyles());

positions.writeAtom(MOVED_ATOM_ID, 1.5, -2.25, 0.5);

const matrix = atomState.buffer("matrix");
assert(matrix[60] === 1.5, `matrix translation x ${matrix[60]}`);
assert(matrix[61] === -2.25, `matrix translation y ${matrix[61]}`);
assert(matrix[62] === 0.5, `matrix translation z ${matrix[62]}`);

const instanceData = atomState.buffer("instanceData");
assert(instanceData[12] === 1.5, `instanceData x ${instanceData[12]}`);
assert(instanceData[13] === -2.25, `instanceData y ${instanceData[13]}`);
assert(instanceData[14] === 0.5, `instanceData z ${instanceData[14]}`);

// --- The partial dirty lane: exactly the two buffers that were rewritten ----

assert(
  atomState.dirtied.join(",") === "matrix,instanceData",
  `dirty buffers ${atomState.dirtied.join(",")}`,
);

// --- ScenePaintTick.flush: paint, dirty, highlight — in that order ----------

const paintTick = new ScenePaintTick(
  new FakePainter(order),
  scene,
  new FakeHighlighter(order),
);

paintTick.flush();

assert(
  order.join(",") ===
    "applySceneIndexToMeshes,markAllUnsaved,invalidateAndRebuild",
  `flush order ${order.join(",")}`,
);

console.log("optimize-staging-01-positions ok");
