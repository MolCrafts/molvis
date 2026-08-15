/**
 * Contract lock for staging an optimize result: the relaxed coordinates land on
 * the canvas as one reversible action, the hydrogens the optimizer added come
 * and go with it, and the old direct-to-HEAD publish path is gone from the
 * build output.
 *
 * Goldens are literals typed in here, not captured from any tool or optimizer:
 *
 * - Before: three atoms at (0, 0, 0), (1, 0, 0) and (0, 0, 0) Å — the scene as
 *   the user last saw it.
 * - Staged: (0.10, 0, 0), (0.90, 0, 0) and (0, 0.05, 0) Å — the plan, verbatim.
 *   Nothing computes them; carrying them unchanged is the whole contract.
 * - Restored: the three "before" positions, and only those. They are the values
 *   `do()` captured when it ran, which is why the fake scene below is moved
 *   between construction and execution.
 * - Two capped hydrogens (rows 3 and 4 of the plan) become atom ids 3 and 4.
 *   Redo replays those ids instead of allocating 5 and 6 — a redo that
 *   duplicates them grows the molecule on every Ctrl+Shift+Z.
 *
 * Coordinates cross this path as plain doubles (atom meta is written with the
 * numbers the plan carries, never re-read from a float32 buffer), so every
 * position assert is an exact comparison; a tolerance here would hide a
 * precision-losing detour.
 *
 * The second half is a build-output scan: `runOptimize` must no longer contain
 * `ensureDataSourceAndDraws` (the DataSource/auto-attach publish) or
 * `applyPipeline` (the full scene rebuild). One behaviour, one path — a
 * surviving branch would put the result on HEAD behind the user's back.
 *
 * Run with the repo TS runner: `node regressions/optimize-staging-03-command.ts`
 * after `npm run build:stage`.
 *
 * `commands/optimize_result` is a stage-internal seam and by invariant is on no
 * public barrel (it carries no `@command` decorator and is deliberately absent
 * from `commands/index.ts`), so it is pinned at its build-output deep path —
 * same convention as `regressions/optimize-staging-01-positions.ts`. Its runtime
 * closure pulls in the edit-pool writer, the draw commands and through them
 * `@babylonjs/core`; no engine, canvas or scene is created here, no WebAssembly
 * (WASM) module is instantiated, no molrs call is made and no external process
 * runs. Every collaborator below is a plain object.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { StageOptimizeResultCommand } from "../stage/dist/commands/optimize_result.js";

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}

/**
 * The two constructor surfaces, taken from the class itself — that keeps this
 * script's import list at exactly one product module.
 */
type StageApp = ConstructorParameters<typeof StageOptimizeResultCommand>[0];
type StagePlan = ConstructorParameters<typeof StageOptimizeResultCommand>[1];
type ImpostorBuffer = { data: Float32Array; stride: number };
type Position = { x: number; y: number; z: number };

const MATRIX_STRIDE = 16;
const INSTANCE_DATA_STRIDE = 4;
const CAPACITY = 16;
const ATOM_MESH_ID = 11;
const BOND_MESH_ID = 22;

/** Atoms already on the canvas; their ids are their render rows (identity). */
const BASE_ATOM_COUNT = 3;
const BASE_ELEMENTS = ["C", "C", "O"];
const BEFORE: Position[] = [
  { x: 0, y: 0, z: 0 },
  { x: 1, y: 0, z: 0 },
  { x: 0, y: 0, z: 0 },
];
/** What the optimizer proposes for those three atoms (Å). */
const STAGED: Position[] = [
  { x: 0.1, y: 0, z: 0 },
  { x: 0.9, y: 0, z: 0 },
  { x: 0, y: 0.05, z: 0 },
];
/** The two hydrogens it added to cap valences (Å). */
const ADDED: Position[] = [
  { x: 1.6, y: 0.3, z: 0 },
  { x: -0.5, y: 0.2, z: 0 },
];
/** Ids those hydrogens must take — and keep across undo/redo. */
const ADDED_IDS = [3, 4];

/** Impostor rows of the atom layer: ids 0..2 are the frame segment. */
class FakeAtomImpostorState {
  mesh: { uniqueId: number };
  buffers: Map<string, ImpostorBuffer>;
  frameOffset: number;
  idToIndex: Map<number, number>;

  constructor() {
    this.mesh = { uniqueId: ATOM_MESH_ID };
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
    this.frameOffset = BASE_ATOM_COUNT;
    this.idToIndex = new Map<number, number>();
  }

  renderIndicesForLogicalId(id: number): number[] {
    if (id < this.frameOffset) return [id];
    const editIndex = this.idToIndex.get(id);
    return editIndex === undefined ? [] : [editIndex + this.frameOffset];
  }

  markDirty(): void {}
}

/**
 * The scene surface a staged result drives: atom meta to capture and rewrite,
 * id allocation, and the dirty flag. No bond layer — this scenario asserts
 * atoms, and bond rebuilds are `optimize-staging-01-positions`' contract.
 */
class FakeScene {
  atomState: FakeAtomImpostorState;
  metas: Map<number, { atomId: number; element: string; position: Position }>;
  meshRegistry: {
    getAtomState: () => FakeAtomImpostorState;
    getBondState: () => null;
  };
  metaRegistry: {
    atoms: {
      getMeta: (id: number) => {
        atomId: number;
        element: string;
        position: Position;
      } | null;
    };
    bonds: { getMeta: () => null };
  };
  topology: {
    incident: () => number[];
    endpoints: () => undefined;
    addAtom: (id: number) => void;
    removeAtom: (id: number) => void;
    addBond: () => void;
    removeBond: () => void;
  };
  unsavedFlags: number;

  constructor() {
    this.atomState = new FakeAtomImpostorState();
    this.metas = new Map();
    for (let id = 0; id < BASE_ATOM_COUNT; id++) {
      this.metas.set(id, {
        atomId: id,
        element: BASE_ELEMENTS[id],
        position: { ...BEFORE[id] },
      });
    }
    this.unsavedFlags = 0;
    this.meshRegistry = {
      getAtomState: () => this.atomState,
      getBondState: () => null,
    };
    this.metaRegistry = {
      atoms: { getMeta: (id: number) => this.metas.get(id) ?? null },
      bonds: { getMeta: () => null },
    };
    this.topology = {
      incident: () => [],
      endpoints: () => undefined,
      addAtom: () => {},
      removeAtom: () => {},
      addBond: () => {},
      removeBond: () => {},
    };
  }

  /** Next free logical id, the way `SceneIndex` derives it: max id + 1. */
  getNextAtomId(): number {
    let max = -1;
    for (const id of this.metas.keys()) max = Math.max(max, id);
    return max + 1;
  }

  getNextBondId(): number {
    return 0;
  }

  /** New meta object per write — the staged result never mutates in place. */
  updateAtom(
    _meshId: number,
    atomId: number,
    meta: { position?: Position },
  ): void {
    const existing = this.metas.get(atomId);
    if (!existing || !meta.position) return;
    this.metas.set(atomId, { ...existing, position: { ...meta.position } });
  }

  updateBond(): void {
    throw new Error("this scenario rebuilds no bond");
  }

  bondPlaneAxis(): void {
    throw new Error("this scenario rebuilds no bond");
  }

  markAllUnsaved(): void {
    this.unsavedFlags += 1;
  }

  position(atomId: number): Position {
    const meta = this.metas.get(atomId);
    if (!meta) throw new Error(`atom ${atomId} is not on the scene`);
    return meta.position;
  }
}

/** Artist stand-in: creates and removes edit-pool entities, paints nothing. */
class FakeArtist {
  scene: FakeScene;
  bondIds: number[];
  paints: number;

  constructor(scene: FakeScene) {
    this.scene = scene;
    this.bondIds = [];
    this.paints = 0;
  }

  async drawAtom(
    position: Position,
    options: { element: string; atomId?: number },
  ): Promise<{ atomId: number; meshId: number }> {
    const atomId = options.atomId ?? this.scene.getNextAtomId();
    this.scene.metas.set(atomId, {
      atomId,
      element: options.element,
      position: { x: position.x, y: position.y, z: position.z },
    });
    return { atomId, meshId: ATOM_MESH_ID };
  }

  async drawBond(
    _start: Position,
    _end: Position,
    options: { bondId?: number },
  ): Promise<{ bondId: number; meshId: number }> {
    const bondId = options.bondId ?? 0;
    this.bondIds.push(bondId);
    return { bondId, meshId: BOND_MESH_ID };
  }

  deleteAtom(_meshId: number, atomId: number): void {
    this.scene.metas.delete(atomId);
  }

  deleteBond(_meshId: number, bondId: number): void {
    this.bondIds = this.bondIds.filter((id) => id !== bondId);
  }

  applySceneIndexToMeshes(): void {
    this.paints += 1;
  }
}

class FakeHighlighter {
  rebuilds: number;

  constructor() {
    this.rebuilds = 0;
  }

  invalidateAndRebuild(): void {
    this.rebuilds += 1;
  }
}

class FakeStyleManager {
  getAtomStyle(): { radius: number; color: string } {
    return { radius: 0.3, color: "#ffffff" };
  }

  getBondStyle(): { radius: number } {
    return { radius: 0.15 };
  }
}

/** Atom ids that exist beyond the frame segment — the added hydrogens. */
function addedAtomIds(scene: FakeScene): number[] {
  return [...scene.metas.keys()]
    .filter((id) => id >= BASE_ATOM_COUNT)
    .sort((a, b) => a - b);
}

function assertPositions(scene: FakeScene, expected: Position[], when: string) {
  for (let id = 0; id < expected.length; id++) {
    const p = scene.position(id);
    assert(p.x === expected[id].x, `${when}: atom ${id} x ${p.x}`);
    assert(p.y === expected[id].y, `${when}: atom ${id} y ${p.y}`);
    assert(p.z === expected[id].z, `${when}: atom ${id} z ${p.z}`);
  }
}

// --- The plan: three relaxed atoms plus two capped hydrogens ----------------

const plan: StagePlan = {
  x: Float64Array.from([...STAGED, ...ADDED].map((p) => p.x)),
  y: Float64Array.from([...STAGED, ...ADDED].map((p) => p.y)),
  z: Float64Array.from([...STAGED, ...ADDED].map((p) => p.z)),
  elements: [...BASE_ELEMENTS, "H", "H"],
  // The first two bonds are topology the canvas already carries; only the last
  // two touch a new atom and may be drawn.
  bondI: Uint32Array.from([0, 1, 0, 0]),
  bondJ: Uint32Array.from([1, 2, 3, 4]),
  bondType: Uint32Array.from([1, 1, 1, 1]),
  baseAtomCount: BASE_ATOM_COUNT,
};

const scene = new FakeScene();
const artist = new FakeArtist(scene);
const highlighter = new FakeHighlighter();
const app = {
  world: { sceneIndex: scene, highlighter },
  artist,
  styleManager: new FakeStyleManager(),
} as unknown as StageApp;

// Construct first, then move the scene: the snapshot must be taken by `do()`,
// so these are the positions an undo has to restore.
const command = new StageOptimizeResultCommand(app, plan);
for (let id = 0; id < BASE_ATOM_COUNT; id++) {
  scene.metas.set(id, {
    atomId: id,
    element: BASE_ELEMENTS[id],
    position: { ...BEFORE[id] },
  });
}

// --- do(): the plan's coordinates and its two hydrogens are on the canvas ---

await command.do();

assertPositions(scene, STAGED, "staged");
assert(
  addedAtomIds(scene).join(",") === ADDED_IDS.join(","),
  `staged added atom ids ${addedAtomIds(scene).join(",")}`,
);
assert(
  scene.position(ADDED_IDS[0]).x === ADDED[0].x &&
    scene.position(ADDED_IDS[0]).y === ADDED[0].y,
  `staged hydrogen 0 at ${JSON.stringify(scene.position(ADDED_IDS[0]))}`,
);
assert(
  artist.bondIds.length === 2,
  `staged new bonds ${artist.bondIds.length}`,
);
assert(highlighter.rebuilds === 1, `flushes after do ${highlighter.rebuilds}`);

// --- undo(): back to what the user saw, hydrogens and bonds gone ------------

await command.undo();

assertPositions(scene, BEFORE, "restored");
assert(
  addedAtomIds(scene).length === 0,
  `atoms left after undo ${addedAtomIds(scene).join(",")}`,
);
assert(artist.bondIds.length === 0, `bonds left after undo ${artist.bondIds}`);
assert(
  highlighter.rebuilds === 2,
  `flushes after undo ${highlighter.rebuilds}`,
);

// --- redo(): the same staged state, not a second copy of it -----------------

await command.do();

assertPositions(scene, STAGED, "redone");
assert(
  addedAtomIds(scene).join(",") === ADDED_IDS.join(","),
  `redone added atom ids ${addedAtomIds(scene).join(",")}`,
);
assert(
  artist.bondIds.length === 2,
  `redone new bonds ${artist.bondIds.length}`,
);
assert(
  highlighter.rebuilds === 3,
  `flushes after redo ${highlighter.rebuilds}`,
);

// --- The direct-to-HEAD publish path is gone from the build output ----------

const structureJs = readFileSync(
  join(
    dirname(fileURLToPath(import.meta.url)),
    "../stage/dist/optimize/structure.js",
  ),
  "utf8",
);
assert(
  !structureJs.includes("ensureDataSourceAndDraws"),
  "stage/dist/optimize/structure.js still installs a DataSource for the result",
);
assert(
  !structureJs.includes("applyPipeline"),
  "stage/dist/optimize/structure.js still rebuilds the scene after optimizing",
);

console.log("optimize-staging-03-command ok");
