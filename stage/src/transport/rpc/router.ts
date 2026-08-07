/**
 * JSON-RPC router: dispatches inbound requests from a controller
 * (Python / other language) into `MolvisApp` commands and property
 * accessors. The single frontend router — no parallel anywidget copy.
 */

import { Vector3 } from "@babylonjs/core";
import { type Box, Frame } from "@molcrafts/molvis-core/molrs";
import type { MolvisApp } from "../../app";
import { ClassicTheme } from "../../artist/presets/classic";
import { ModernTheme } from "../../artist/presets/modern";
import { VividTheme } from "../../artist/presets/vivid";
import {
  findRepresentation,
  REPRESENTATION_IDS,
  type RepresentationId,
} from "../../artist/representation";
import {
  fitCameraView,
  lookAtCamera,
  readCameraPose,
  resetCameraView,
  setCameraPose,
} from "../../camera/control";
import { DrawAtomCommand, DrawBondCommand } from "../../commands/draw";
import { PlaceMoleculeCommand } from "../../commands/place_molecule";
import { viewAtomCoords } from "../../io/atom_coords";
import { CameraTrackModifier } from "../../modifiers/CameraTrackModifier";
import type { MarkAtomOverlay } from "../../overlays/mark_atom";
import type { MarkAtomProps } from "../../overlays/types";
import {
  DATA_SOURCE_CATEGORY,
  DataSource,
  MemoryDataSource,
} from "../../pipeline/data_source";
import type { PipelineEntry } from "../../pipeline/entry";
import type { Modifier } from "../../pipeline/modifier";
import { ModifierRegistry } from "../../pipeline/modifier_registry";
import { Trajectory } from "../../system/trajectory";
import { listRpcMethods, RPC_METHODS, RPC_PROTOCOL_VERSION } from "./catalog";
import {
  decodeBox,
  decodeFrame,
  encodeFrame,
  FramePayloadError,
} from "./serialization";
import type { JsonRPCRequest, RPCResponseEnvelope } from "./types";
import { createErrorResponse, createSuccessResponse } from "./types";

enum JsonRPCErrorCode {
  ParseError = -32700,
  InvalidRequest = -32600,
  MethodNotFound = -32601,
  InvalidParams = -32602,
  InternalError = -32603,
}

class RPCError extends Error {
  public readonly code: JsonRPCErrorCode;
  public readonly data?: unknown;

  constructor(code: JsonRPCErrorCode, message: string, data?: unknown) {
    super(message);
    this.name = "RPCError";
    this.code = code;
    this.data = data;
  }
}

type RPCHandler = (
  params: Record<string, unknown>,
  buffers: DataView[],
) => Promise<unknown> | unknown;

/**
 * A handler result that carries binary buffers alongside the JSON.
 *
 * Returning one is how a response uses the same buffer channel inbound
 * requests do, instead of inflating dense columns into JSON number arrays.
 */
export class BinaryResult {
  constructor(
    readonly result: unknown,
    readonly buffers: ArrayBuffer[],
  ) {}
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

function invalidParams(message: string, data?: unknown): RPCError {
  return new RPCError(JsonRPCErrorCode.InvalidParams, message, data);
}

function invalidRequest(message: string, data?: unknown): RPCError {
  return new RPCError(JsonRPCErrorCode.InvalidRequest, message, data);
}

function parseError(message: string, data?: unknown): RPCError {
  return new RPCError(JsonRPCErrorCode.ParseError, message, data);
}

function ensureFiniteNumber(value: unknown, label: string): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  // Pyodide / JSON sometimes hand us numeric strings; accept them.
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  throw invalidParams(`${label} must be a finite number`);
}

/** Coerce optional finite number; undefined when absent / non-numeric. */
function optionalFiniteNumber(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function toRepresentationId(style: unknown): RepresentationId | null {
  return typeof style === "string" &&
    REPRESENTATION_IDS.includes(style as RepresentationId)
    ? (style as RepresentationId)
    : null;
}

function toNumberArray(value: unknown): number[] | null {
  if (ArrayBuffer.isView(value)) {
    return Array.from(value as unknown as ArrayLike<number>, Number);
  }
  if (!Array.isArray(value)) {
    return null;
  }
  const out: number[] = [];
  for (const item of value) {
    if (typeof item === "number" && Number.isFinite(item)) {
      out.push(item);
      continue;
    }
    if (typeof item === "string" && item.trim() !== "") {
      const n = Number(item);
      if (Number.isFinite(n)) {
        out.push(n);
        continue;
      }
    }
    return null;
  }
  return out;
}

/**
 * One `scene.set_frame_labels` column: a wire `f64` column, same as any Frame
 * column, so a caller that can build a Frame can build this without a second
 * encoding to learn.
 */
function decodeLabelColumn(
  name: string,
  value: unknown,
  buffers: readonly DataView[],
): Float64Array {
  const column = asRecord(value);
  if (column.dtype !== "f64") {
    throw invalidParams(
      `labels['${name}'] must be an f64 column ({dtype: "f64", data}), received ${JSON.stringify(column.dtype)}`,
    );
  }
  const block = decodeFrame(
    { blocks: { labels: { columns: { [name]: column } } } },
    buffers,
    "scene.set_frame_labels",
  );
  try {
    return block.getBlock("labels")?.copyColF(name) ?? new Float64Array();
  } finally {
    block.free?.();
  }
}

function toIntegerIdList(value: unknown, label: string): number[] {
  const values = toNumberArray(value);
  if (!values) {
    throw invalidParams(`${label} must be an array of integer ids`);
  }
  if (!values.every((item) => Number.isInteger(item) && item >= 0)) {
    throw invalidParams(`${label} must contain only non-negative integers`);
  }
  return values;
}

function applyStyleRadii(
  app: MolvisApp,
  params: Record<string, unknown>,
): void {
  const atoms = asRecord(params.atoms);
  const bonds = asRecord(params.bonds);

  if (atoms.radius != null) {
    app.styleManager.setAtomRadiusScale(
      ensureFiniteNumber(atoms.radius, "atoms.radius"),
    );
  }

  if (bonds.radius != null) {
    app.styleManager.setBondRadiusScale(
      ensureFiniteNumber(bonds.radius, "bonds.radius"),
    );
  }
}

/**
 * Apply representation / outline / radii, then **one** pipeline rebuild.
 *
 * Historical bug: `setRepresentation` + `setRepresentationOutline` + a
 * trailing `rebuildCurrentFrame` each called `applyPipeline({ fullRebuild })`,
 * so `view.set_style` flashed the canvas 2–3 times per call (especially
 * obvious on skeletal, which also rebuilds element labels).
 */
async function applyGlobalStyle(
  app: MolvisApp,
  params: Record<string, unknown>,
): Promise<void> {
  const representationId = toRepresentationId(params.style);
  if (params.style != null && !representationId) {
    throw invalidParams(
      `style must be one of ${REPRESENTATION_IDS.map((id) => `'${id}'`).join(", ")}`,
    );
  }

  let representationTouched = false;

  if (representationId) {
    app.styleManager.setRepresentation(findRepresentation(representationId));
    representationTouched = true;
  }
  if (params.outline != null) {
    const enabled = requireBoolean(params.outline, "outline");
    const current = app.styleManager.getRepresentation();
    if (!current.outlineConfigurable) {
      throw invalidParams(
        `Representation '${current.id}' does not expose a configurable outline`,
      );
    }
    app.styleManager.setOutlineEnabled(enabled);
    representationTouched = true;
  }
  applyStyleRadii(app, params);

  // Single geometry rebuild with all style state already applied.
  if (app.frame) {
    await app.applyPipeline({ fullRebuild: true });
  } else {
    app.artist.redrawFromSceneIndex();
  }

  if (representationTouched) {
    app.events.emit(
      "representation-change",
      app.styleManager.getRepresentation(),
    );
  }
}

/** Serialize a modifier to the wire shape used by ``pipeline.*`` RPCs. */
/**
 * Serialize one pipeline row for `pipeline.list`.
 *
 * Sources and modifiers share the identity fields and diverge after that. A
 * source reports `capabilities: []` and null scope/ownership because it has
 * none — it contributes a trajectory rather than transforming a frame, so it
 * consumes no selection and is owned by nothing. (Before sources left the
 * modifier hierarchy this field read `["transforms-data"]`, inherited from a
 * base class whose `apply()` returned its input unchanged.) The keys stay
 * present so consumers can iterate them uniformly.
 */
function serializeEntry(entry: PipelineEntry): Record<string, unknown> {
  if (entry instanceof DataSource) {
    const source: Record<string, unknown> = {
      id: entry.id,
      name: entry.name,
      capabilities: [],
      enabled: entry.enabled,
      selection_scope_id: null,
      source_owner_id: null,
      category: DATA_SOURCE_CATEGORY,
      kind: entry.kind,
      filename: entry.filename,
      source_type: entry.sourceType,
    };
    if (entry.contributedBlocks.length > 0) {
      source.contributed_blocks = [...entry.contributedBlocks];
    }
    return source;
  }

  const modifier = entry as Modifier;
  return {
    id: modifier.id,
    name: modifier.name,
    capabilities: Array.from(modifier.capabilities),
    enabled: modifier.enabled,
    selection_scope_id: modifier.selectionScopeId,
    source_owner_id: modifier.sourceOwnerId,
  };
}

function requireString(
  value: unknown,
  label: string,
  options: { allowNull?: boolean } = {},
): string | null {
  if (value === null && options.allowNull) return null;
  if (typeof value !== "string" || value.length === 0) {
    throw invalidParams(
      options.allowNull
        ? `${label} must be a non-empty string or null`
        : `${label} must be a non-empty string`,
    );
  }
  return value;
}

function requireBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw invalidParams(`${label} must be a boolean`);
  }
  return value;
}

function requireInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw invalidParams(`${label} must be an integer`);
  }
  return value;
}

/**
 * Extra RPC handlers registered at runtime (e.g. page plugins).
 * Looked up after built-in catalog handlers; not required to appear in
 * {@link RPC_METHODS}.
 */
const extensionHandlers = new Map<string, RPCHandler>();

/**
 * Register a non-catalog RPC method. Returns a disposer that removes it.
 * Intended for page plugins (`plugin.<id>.…` names recommended).
 */
export function registerRpcExtensionHandler(
  name: string,
  handler: RPCHandler,
): () => void {
  if (!name || typeof name !== "string") {
    throw new Error("RPC extension name must be a non-empty string");
  }
  if (typeof handler !== "function") {
    throw new Error("RPC extension handler must be a function");
  }
  extensionHandlers.set(name, handler);
  return () => {
    if (extensionHandlers.get(name) === handler) {
      extensionHandlers.delete(name);
    }
  };
}

/** List currently registered extension (plugin) RPC method names. */
export function listRpcExtensionHandlers(): string[] {
  return Array.from(extensionHandlers.keys()).sort();
}

export class RPCRouter {
  private readonly app: MolvisApp;
  private readonly handlers: Map<string, RPCHandler>;

  constructor(app: MolvisApp) {
    this.app = app;
    // Handlers keyed by {@link RPC_METHODS} catalog names — keep in sync.
    this.handlers = new Map<string, RPCHandler>([
      ["scene.new_frame", this.handleNewFrame],
      ["scene.draw_frame", this.handleDrawFrame],
      ["scene.draw_atom", this.handleDrawAtom],
      ["scene.draw_bond", this.handleDrawBond],
      ["scene.draw_box", this.handleDrawBox],
      ["scene.commit", this.handleCommit],
      ["scene.clear", this.handleClear],
      ["scene.export_frame", this.handleExportFrame],
      ["scene.set_trajectory", this.handleSetTrajectory],
      ["scene.append_frame", this.handleAppendFrame],
      ["scene.set_frame_labels", this.handleSetFrameLabels],
      ["scene.seek_frame", this.handleSeekFrame],
      ["scene.apply_state", this.handleApplyState],
      ["selection.get", this.handleSelectionGet],
      ["selection.select_atoms", this.handleSelectionSelectAtoms],
      ["selection.clear", this.handleSelectionClear],
      [
        "selection.select_by_expression",
        this.handleSelectionSelectByExpression,
      ],
      ["pipeline.list", this.handlePipelineList],
      ["pipeline.available_modifiers", this.handlePipelineAvailableModifiers],
      ["pipeline.add_modifier", this.handlePipelineAddModifier],
      ["pipeline.remove_modifier", this.handlePipelineRemoveModifier],
      ["pipeline.reorder_modifier", this.handlePipelineReorderModifier],
      ["pipeline.set_enabled", this.handlePipelineSetEnabled],
      ["pipeline.set_selection_scope", this.handlePipelineSetSelectionScope],
      ["pipeline.set_source_owner", this.handlePipelineSetSourceOwner],
      ["pipeline.clear", this.handlePipelineClear],
      ["scene.add_data_source", this.handleAddDataSource],
      ["scene.remove_data_source", this.handleRemoveDataSource],
      ["scene.list_data_sources", this.handleListDataSources],
      ["snapshot.take", this.handleSnapshotTake],
      ["overlay.mark_atom", this.handleOverlayMarkAtom],
      ["overlay.unmark_atom", this.handleOverlayUnmarkAtom],
      ["view.set_style", this.handleSetStyle],
      ["view.set_theme", this.handleSetTheme],
      ["view.set_mode", this.handleSetMode],
      ["camera.get_pose", this.handleCameraGetPose],
      ["camera.set_pose", this.handleCameraSetPose],
      ["camera.look_at", this.handleCameraLookAt],
      ["camera.fit", this.handleCameraFit],
      ["camera.reset", this.handleCameraReset],
      ["camera.track", this.handleCameraTrack],
      ["camera.stop_track", this.handleCameraStopTrack],
      ["state.get", this.handleStateGet],
      ["rpc.list_methods", this.handleListMethods],
    ]);
    // Fail fast if a catalog method has no handler (or an extra handler
    // was registered without catalog entry).
    for (const name of RPC_METHODS) {
      if (!this.handlers.has(name)) {
        throw new Error(
          `RPC catalog method '${name}' has no handler (protocol ${RPC_PROTOCOL_VERSION})`,
        );
      }
    }
    for (const name of this.handlers.keys()) {
      if (!RPC_METHODS.includes(name as (typeof RPC_METHODS)[number])) {
        throw new Error(
          `RPC handler '${name}' missing from catalog (protocol ${RPC_PROTOCOL_VERSION})`,
        );
      }
    }
  }

  public async execute(
    request: unknown,
    buffers: DataView[] = [],
  ): Promise<RPCResponseEnvelope> {
    let parsed: JsonRPCRequest;
    try {
      parsed = this.parseRequest(request);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (error instanceof RPCError) {
        return {
          content: createErrorResponse(
            null,
            error.code,
            error.message,
            error.data,
          ),
        };
      }
      return {
        content: createErrorResponse(
          null,
          JsonRPCErrorCode.InvalidRequest,
          message,
        ),
      };
    }

    const method = parsed.method;

    // A disabled session answers; it never goes quiet. Half this catalog is
    // request/response (`snapshot.take`, `scene.export_frame`, `state.get`),
    // and the caller blocks on those — dropping the request silently reads as
    // a dead network instead of a switch the operator flipped.
    const session = this.app.modifierPipeline?.session();
    if (session && !session.enabled) {
      return {
        content: createErrorResponse(
          parsed.id,
          JsonRPCErrorCode.InvalidRequest,
          `Session '${session.id}' is disabled; re-enable it in the pipeline to accept '${method}'`,
        ),
      };
    }

    const handler = this.handlers.get(method) ?? extensionHandlers.get(method);

    if (!handler) {
      return {
        content: createErrorResponse(
          parsed.id,
          JsonRPCErrorCode.MethodNotFound,
          `Method not found: ${parsed.method}`,
        ),
      };
    }

    try {
      const result = await handler(asRecord(parsed.params), buffers);
      if (result instanceof BinaryResult) {
        return {
          content: createSuccessResponse(parsed.id, result.result),
          buffers: result.buffers,
        };
      }
      return {
        content: createSuccessResponse(parsed.id, result),
      };
    } catch (error) {
      if (error instanceof FramePayloadError) {
        // A malformed molecular payload is the producer's bug; report it as
        // invalid params with the block.column path the codec identified.
        return {
          content: createErrorResponse(
            parsed.id,
            JsonRPCErrorCode.InvalidParams,
            error.message,
            error.path ? { path: error.path } : undefined,
          ),
        };
      }
      if (error instanceof RPCError) {
        return {
          content: createErrorResponse(
            parsed.id,
            error.code,
            error.message,
            error.data,
          ),
        };
      }

      const message = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : undefined;
      console.error(
        `RPC execution failed [${method}]: ${message}`,
        stack ?? error,
      );
      return {
        content: createErrorResponse(
          parsed.id,
          JsonRPCErrorCode.InternalError,
          message,
        ),
      };
    }
  }

  private parseRequest(request: unknown): JsonRPCRequest {
    let candidate = request;
    if (typeof request === "string") {
      try {
        candidate = JSON.parse(request) as unknown;
      } catch (error) {
        throw parseError("Malformed JSON-RPC payload", {
          cause: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (typeof candidate !== "object" || candidate === null) {
      throw invalidRequest("JSON-RPC payload must be an object");
    }

    const parsed = candidate as Partial<JsonRPCRequest>;
    if (parsed.jsonrpc !== "2.0" || typeof parsed.method !== "string") {
      throw invalidRequest("Invalid JSON-RPC request");
    }
    if (typeof parsed.id !== "number") {
      throw invalidRequest("JSON-RPC requests must include a numeric id");
    }

    return {
      jsonrpc: "2.0",
      id: parsed.id,
      method: parsed.method,
      params: asRecord(parsed.params),
    };
  }

  private handleNewFrame: RPCHandler = async (params) => {
    if (params.clear === false) {
      return { success: true };
    }
    const frame = new Frame();
    await this.app.setTrajectory(new Trajectory([frame]), {
      sourceType: "empty",
      filename: "",
    });
    await this.app.applyPipeline({ fullRebuild: true });
    this.app.world.fit();
    return { success: true };
  };

  /**
   * Place a structure into the **edit working tree** (same path as Edit mode
   * stamp / PlaceMoleculeCommand). Does **not** write molrs HEAD — that is
   * {@link handleCommit} / Ctrl+S only. Does **not** move the camera —
   * callers that want framing use `camera.fit` / {@link World.fit}.
   */
  private handleDrawFrame: RPCHandler = async (params, buffers) => {
    if (!params.frame) {
      throw invalidParams("scene.draw_frame requires a 'frame' payload");
    }
    if (Object.keys(asRecord(params.options)).length > 0) {
      throw invalidParams(
        "scene.draw_frame accepts data only; use dedicated view commands for global visual settings",
      );
    }
    // The box rides on the frame (molrs `Frame.box`). A top-level `box` is the
    // pre-wire spelling and is refused rather than silently ignored.
    if (params.box !== undefined) {
      throw invalidParams(
        "scene.draw_frame no longer takes a top-level 'box'; put it on the frame payload",
      );
    }
    const frame = decodeFrame(params.frame, buffers, "scene.draw_frame frame");
    const atoms = frame.getBlock("atoms");
    const nAtoms = atoms?.nrows() ?? 0;
    if (nAtoms === 0) {
      throw invalidParams(
        "scene.draw_frame: frame has no atoms (nothing to place in the working tree)",
      );
    }

    // PlaceMoleculeCommand centers the template on `target`. Pass the
    // molecule centroid so absolute coordinates are preserved (offset = 0).
    const target = moleculeCentroid(frame);
    const baseAtomId = this.app.world.sceneIndex.getNextAtomId();
    await this.app.commandManager.execute(
      new PlaceMoleculeCommand(this.app, frame, target),
    );
    this.app.world.renderOnce();

    const atomIds = Array.from({ length: nAtoms }, (_, i) => baseAtomId + i);
    return { success: true, atomIds };
  };

  /**
   * Place one atom in the edit working tree (DrawAtomCommand). HEAD unchanged
   * until scene.commit / Ctrl+S.
   */
  private handleDrawAtom: RPCHandler = async (params) => {
    const x = Number(params.x);
    const y = Number(params.y);
    const z = Number(params.z);
    if (![x, y, z].every((v) => Number.isFinite(v))) {
      throw invalidParams(
        "scene.draw_atom requires finite numeric x, y, z coordinates",
      );
    }
    const elementRaw = params.element ?? params.symbol;
    if (typeof elementRaw !== "string" || elementRaw.length === 0) {
      throw invalidParams(
        "scene.draw_atom requires a non-empty 'element' (or 'symbol') string",
      );
    }
    const element = elementRaw;
    const result = await this.app.commandManager.execute(
      new DrawAtomCommand(this.app, new Vector3(x, y, z), { element }),
    );
    this.app.world.renderOnce();
    return { success: true, atomId: result.atomId };
  };

  /**
   * Place one bond in the edit working tree (DrawBondCommand). Atom indices
   * are **scene atom ids** (as returned by scene.draw_atom / draw_frame).
   */
  private handleDrawBond: RPCHandler = async (params) => {
    const atomi = params.atomi;
    const atomj = params.atomj;
    if (
      typeof atomi !== "number" ||
      typeof atomj !== "number" ||
      !Number.isInteger(atomi) ||
      !Number.isInteger(atomj) ||
      atomi < 0 ||
      atomj < 0
    ) {
      throw invalidParams(
        "scene.draw_bond requires non-negative integer atomi and atomj (scene atom ids)",
      );
    }
    const meta1 = this.app.world.sceneIndex.metaRegistry.atoms.getMeta(atomi);
    const meta2 = this.app.world.sceneIndex.metaRegistry.atoms.getMeta(atomj);
    if (!meta1 || !meta2) {
      throw invalidParams(
        `scene.draw_bond: atom ids (${atomi}, ${atomj}) not in the working tree — draw atoms first`,
      );
    }
    const order =
      typeof params.order === "number" && Number.isFinite(params.order)
        ? params.order
        : 1;
    const start = new Vector3(
      meta1.position.x,
      meta1.position.y,
      meta1.position.z,
    );
    const end = new Vector3(
      meta2.position.x,
      meta2.position.y,
      meta2.position.z,
    );
    const result = await this.app.commandManager.execute(
      new DrawBondCommand(this.app, start, end, {
        order,
        atomId1: atomi,
        atomId2: atomj,
      }),
    );
    this.app.world.renderOnce();
    return { success: true, bondId: result.bondId };
  };

  /**
   * Commit the edit working tree into molrs HEAD (same as Ctrl+S).
   */
  private handleCommit: RPCHandler = async () => {
    await this.app.commitScene();
    return { success: true };
  };

  private handleDrawBox: RPCHandler = (params, buffers) => {
    if (!params.box) {
      throw invalidParams("scene.draw_box requires a 'box' payload");
    }
    const box = decodeBox(params.box, buffers, "scene.draw_box box");

    this.app.artist.drawBox(box);

    const currentFrame = this.app.frame;
    if (currentFrame) {
      this.app.system.updateCurrentFrame(currentFrame, box);
    }

    return { success: true };
  };

  private handleClear: RPCHandler = async () => {
    const frame = new Frame();
    await this.app.setTrajectory(new Trajectory([frame]), {
      sourceType: "empty",
      filename: "",
    });
    await this.app.applyPipeline({ fullRebuild: true });
    this.app.world.fit();
    return { success: true };
  };

  private handleSetTrajectory: RPCHandler = async (params, buffers) => {
    const rawFrames = params.frames;
    if (!Array.isArray(rawFrames) || rawFrames.length === 0) {
      throw invalidParams(
        "scene.set_trajectory requires a non-empty 'frames' array",
      );
    }
    if (params.boxes !== undefined) {
      // A parallel boxes array could not be length-checked against frames and
      // silently padded with undefined. Each frame carries its own box now.
      throw invalidParams(
        "scene.set_trajectory no longer takes a parallel 'boxes' array; put each box on its frame",
      );
    }

    const frames: Frame[] = rawFrames.map((raw, i) =>
      decodeFrame(raw, buffers, `scene.set_trajectory frames[${i}]`),
    );
    const boxes: (Box | undefined)[] = frames.map((frame) => frame.box);

    const sessionLabel = this.sessionLabel(frames.length);
    await this.app.setTrajectory(new Trajectory(frames, boxes), {
      sourceType: "backend",
      filename: sessionLabel,
    });
    await this.app.applyPipeline({ fullRebuild: true });
    this.app.world.fit();
    return { success: true, nFrames: frames.length };
  };

  /**
   * Append one frame to the live trajectory — the streaming ingress.
   *
   * Distinct from {@link handleSetTrajectory} in three ways that matter for a
   * running simulation:
   *
   * - it sends one frame, not the run so far, so a stream costs O(N) bytes
   *   rather than O(N²);
   * - it does **not** force a full pipeline rebuild. Following the tail goes
   *   through `seekFrame`, so `classifyFrameTransition` gets to decide, and a
   *   step that only moved atoms is a buffer update rather than a scene
   *   rebuild;
   * - it does **not** re-fit the camera. A view that re-framed itself every
   *   step would be unusable. The camera is framed once, on the frame that
   *   installs the scene.
   *
   * `follow` (default true) seeks to the new frame. Pass false to keep the
   * playhead where the user parked it while frames continue to arrive.
   */
  private handleAppendFrame: RPCHandler = async (params, buffers) => {
    if (!params.frame) {
      throw invalidParams("scene.append_frame requires a 'frame' payload");
    }
    if (params.box !== undefined) {
      throw invalidParams(
        "scene.append_frame does not take a top-level 'box'; put it on the frame payload",
      );
    }
    const follow = params.follow === undefined ? true : Boolean(params.follow);
    const frame = decodeFrame(
      params.frame,
      buffers,
      "scene.append_frame frame",
    );

    const { index, installedScene } = await this.app.appendFrame(
      frame,
      frame.box,
      { sourceType: "backend", filename: this.sessionLabel() },
    );

    if (installedScene) {
      // First frame of the stream: the scene was just built, so nothing is on
      // screen and the camera has never seen these atoms.
      await this.app.applyPipeline({ fullRebuild: true });
      this.app.world.fit();
    } else if (follow) {
      await this.app.seekFrame(index);
    }

    return {
      success: true,
      index,
      nFrames: this.app.system.trajectory.length,
    };
  };

  /**
   * Receive a state snapshot from the Python controller after a fresh
   * WS handshake. The snapshot mirrors what Python last pushed (frames,
   * boxes, pipeline) — we don't apply it here; instead we emit a
   * ``backend-state-sync`` event so the React layer can compare against
   * the local pipeline and either auto-apply (local is empty) or prompt
   * the user to choose between the two.
   */
  private handleApplyState: RPCHandler = (params, buffers) => {
    const decoded = params;

    const rawPipeline = Array.isArray(decoded.pipeline) ? decoded.pipeline : [];
    const pipeline = rawPipeline.map((raw, i) => {
      const entry = asRecord(raw);
      const id = typeof entry.id === "string" ? entry.id : null;
      const name = typeof entry.name === "string" ? entry.name : null;
      const capabilities = Array.isArray(entry.capabilities)
        ? entry.capabilities.filter((c): c is string => typeof c === "string")
        : null;
      if (id === null || name === null || capabilities === null) {
        throw invalidParams(
          `scene.apply_state pipeline[${i}] missing id/name/capabilities`,
        );
      }
      const enabled = typeof entry.enabled === "boolean" ? entry.enabled : true;
      const selection_scope_id =
        typeof entry.selection_scope_id === "string"
          ? entry.selection_scope_id
          : null;
      const source_owner_id =
        typeof entry.source_owner_id === "string"
          ? entry.source_owner_id
          : null;
      const category =
        typeof entry.category === "string" ? entry.category : undefined;
      const kind = typeof entry.kind === "string" ? entry.kind : undefined;
      let source_type: "file" | "empty" | "backend" | undefined;
      if (
        entry.source_type === "file" ||
        entry.source_type === "empty" ||
        entry.source_type === "backend"
      ) {
        source_type = entry.source_type;
      }
      const filename =
        typeof entry.filename === "string" ? entry.filename : undefined;
      const contributed_blocks = Array.isArray(entry.contributed_blocks)
        ? entry.contributed_blocks.filter(
            (b): b is string => typeof b === "string",
          )
        : undefined;
      const parsed: import("../../events").BackendStateSyncPipelineEntry = {
        id,
        name,
        category,
        capabilities,
        enabled,
        selection_scope_id,
        source_owner_id,
        kind,
        filename,
        source_type,
        contributed_blocks,
      };
      return parsed;
    });

    const rawFrames = Array.isArray(decoded.frames) ? decoded.frames : [];
    const frames: Frame[] = rawFrames.map((raw, i) =>
      decodeFrame(raw, buffers, `scene.apply_state frames[${i}]`),
    );
    // Each frame carries its own box, exactly as on the draw_frame path — the
    // snapshot no longer replays a separate parallel array.
    const boxes: (Box | undefined)[] = frames.map((frame) => frame.box);

    this.app.events.emit("backend-state-sync", {
      pipeline,
      frames,
      boxes,
    });

    return { success: true };
  };

  private handleSetFrameLabels: RPCHandler = (params, buffers) => {
    const rawLabels = params.labels;
    const trajectory = this.app.system.trajectory;
    const nFrames = trajectory.length;

    // null → no-op. Python callers that want to clear should set empty
    // strings on the keys they wrote, or delete keys — but molrs currently
    // has no `deleteMeta`, so the convention is "just overwrite".
    if (rawLabels == null) {
      this.app.events.emit("trajectory-change", trajectory);
      return { success: true, nLabels: 0 };
    }
    if (typeof rawLabels !== "object" || Array.isArray(rawLabels)) {
      throw invalidParams(
        "scene.set_frame_labels 'labels' must be an object of column arrays",
      );
    }

    let nLabels = 0;
    for (const [name, value] of Object.entries(
      rawLabels as Record<string, unknown>,
    )) {
      // One column per label, in the wire's own shape — a caller that already
      // knows how to build a Frame column knows how to build this.
      const column = decodeLabelColumn(name, value, buffers);
      if (nFrames > 0 && column.length !== nFrames) {
        throw invalidParams(
          `labels['${name}'] has length ${column.length}, expected ${nFrames}`,
        );
      }
      // Frame meta is the single source of truth. `setMetaScalar` keeps the
      // value a float64; the old `setMeta(name, String(v))` round-tripped every
      // per-frame descriptor through decimal text and lost precision.
      for (let i = 0; i < column.length; i++) {
        trajectory.get(i)?.setMetaScalar(name, column[i]);
      }
      nLabels++;
    }

    this.app.events.emit("trajectory-change", trajectory);
    return { success: true, nLabels };
  };

  /**
   * Seek the trajectory to `index`.
   *
   * The frontend has had `MolvisApp.seekFrame` and a timeline control all
   * along; there was simply no RPC reaching it, so every Python-side playback
   * helper called a `frame.seek` method that did not exist.
   */
  private handleSeekFrame: RPCHandler = async (params) => {
    const index = params.index;
    if (typeof index !== "number" || !Number.isInteger(index) || index < 0) {
      throw invalidParams(
        "scene.seek_frame 'index' must be a non-negative integer",
      );
    }
    const total = this.app.system.trajectory?.length ?? 0;
    if (index >= total) {
      throw invalidParams(
        `scene.seek_frame index ${index} is out of range (${total} frame(s))`,
      );
    }
    await this.app.seekFrame(index);
    return { index: this.app.currentFrame, total };
  };

  private handleExportFrame: RPCHandler = async () => {
    const { frame } = await Promise.resolve(
      this.app.execute<Record<string, never>, { frame: Frame }>(
        "export_frame",
        {},
      ),
    );
    try {
      const encoded = encodeFrame(frame, "scene.export_frame");
      return new BinaryResult({ frame: encoded.frame }, encoded.buffers);
    } finally {
      // The command hands over a temporary frame built from the live scene.
      frame.free?.();
    }
  };

  private handleSelectionGet: RPCHandler = async () => {
    const { frame } = await Promise.resolve(
      this.app.execute<Record<string, never>, { frame: Frame }>(
        "get_selected",
        {},
      ),
    );
    try {
      const encoded = encodeFrame(frame, "selection.get");
      return new BinaryResult({ frame: encoded.frame }, encoded.buffers);
    } finally {
      frame.free?.();
    }
  };

  private handleSelectionSelectAtoms: RPCHandler = (params) => {
    const ids = toIntegerIdList(params.ids ?? [], "ids");
    this.app.execute("select_atoms", { ids });
    return { success: true };
  };

  private handleSelectionClear: RPCHandler = () => {
    this.app.world.selectionManager.clearSelection();
    return { success: true };
  };

  private handleSelectionSelectByExpression: RPCHandler = (params) => {
    const expression =
      typeof params.expression === "string" ? params.expression : "";
    if (!expression) {
      throw invalidParams("expression must be a non-empty string");
    }
    const op = params.op;
    const mode: "replace" | "add" | "remove" | "toggle" =
      op === "add" || op === "remove" || op === "toggle" || op === "replace"
        ? op
        : "replace";
    this.app.world.selectionManager.selectByExpression(expression, mode);
    return { success: true };
  };

  private handleStateGet: RPCHandler = () => {
    const meta = this.app.world.selectionManager.getSelectedMeta();
    return {
      selection: {
        atom_ids: meta.atoms.atomId,
        bond_ids: meta.bonds.bondId,
      },
      // `app.mode` is the live Mode instance, which reaches the Babylon scene,
      // the canvas element and its React fiber — serializing it throws
      // "Converting circular structure to JSON" and the reply is never sent,
      // so the caller only ever sees a timeout. Send the ModeId, matching what
      // `event.mode_changed` already puts on the wire.
      mode: this.app.mode?.name ?? null,
      frame_index: this.app.currentFrame,
      total_frames: this.app.system.trajectory?.length ?? 0,
    };
  };

  private handleCameraGetPose: RPCHandler = () => {
    return readCameraPose(this.app.world.camera);
  };

  private handleCameraSetPose: RPCHandler = (params) => {
    const p = asRecord(params);
    const target = toNumberArray(p.target);
    const alpha = optionalFiniteNumber(p.alpha);
    const beta = optionalFiniteNumber(p.beta);
    const radius = optionalFiniteNumber(p.radius);
    if (
      alpha === undefined &&
      beta === undefined &&
      radius === undefined &&
      target === null
    ) {
      throw invalidParams(
        "camera.set_pose needs at least one of alpha, beta, radius, target",
      );
    }
    const pose = setCameraPose(this.app.world.camera, {
      alpha,
      beta,
      radius,
      target: target ?? undefined,
    });
    this.app.world.renderOnce();
    return { pose };
  };

  private handleCameraLookAt: RPCHandler = (params) => {
    const p = asRecord(params);
    const position = toNumberArray(p.position);
    const target = toNumberArray(p.target);
    const up = toNumberArray(p.up);
    if (!position || !target) {
      throw invalidParams("position and target must be length-3 number arrays");
    }
    const pose = lookAtCamera(this.app.world.camera, {
      position,
      target,
      up: up ?? undefined,
    });
    this.app.world.renderOnce();
    return { pose };
  };

  private handleCameraFit: RPCHandler = () => {
    const pose = fitCameraView(this.app);
    this.app.world.renderOnce();
    return { pose };
  };

  private handleCameraReset: RPCHandler = () => {
    const pose = resetCameraView(this.app);
    this.app.world.renderOnce();
    return { pose };
  };

  /**
   * Install (or replace) a {@link CameraTrackModifier} and start playback.
   * Params: keys[{position,target,up?}], duration, loop, rate.
   */
  private handleCameraTrack: RPCHandler = async (params) => {
    const p = asRecord(params);
    const rawKeys = p.keys;
    if (!Array.isArray(rawKeys) || rawKeys.length < 2) {
      throw invalidParams("camera.track requires keys: array of ≥2 poses");
    }
    const keys = rawKeys.map((raw, i) => {
      const k = asRecord(raw);
      const position = toNumberArray(k.position);
      const target = toNumberArray(k.target);
      const up = toNumberArray(k.up);
      if (!position || !target) {
        throw invalidParams(
          `camera.track keys[${i}] needs position and target length-3 arrays`,
        );
      }
      return {
        position: position as [number, number, number],
        target: target as [number, number, number],
        up: (up as [number, number, number] | null) ?? undefined,
      };
    });

    const duration = Number(p.duration ?? 12);
    if (!(duration > 0) || !Number.isFinite(duration)) {
      throw invalidParams("camera.track duration must be a finite number > 0");
    }
    const rate = Number(p.rate ?? 1);
    if (!(rate > 0) || !Number.isFinite(rate)) {
      throw invalidParams("camera.track rate must be a finite number > 0");
    }
    const loop = p.loop === undefined ? true : Boolean(p.loop);

    // One live camera-track step at a time: remove previous instances.
    const pipeline = this.app.modifierPipeline;
    for (const m of [...pipeline.modifiers()]) {
      if (m instanceof CameraTrackModifier) {
        pipeline.removeEntry(m.id);
      }
    }

    const mod = new CameraTrackModifier(
      `camera-track-${Date.now().toString(36)}`,
    );
    mod.setSpec({ keys, duration, loop, rate });
    pipeline.addModifier(mod);
    await this.app.applyPipeline({ fullRebuild: false });
    return {
      id: mod.id,
      modifier: serializeEntry(mod),
      playing: mod.isPlaying,
    };
  };

  private handleCameraStopTrack: RPCHandler = async () => {
    const pipeline = this.app.modifierPipeline;
    const removed: string[] = [];
    for (const m of [...pipeline.modifiers()]) {
      if (m instanceof CameraTrackModifier) {
        pipeline.removeEntry(m.id);
        removed.push(m.id);
      }
    }
    if (removed.length > 0) {
      await this.app.applyPipeline({ fullRebuild: false });
    }
    return { removed_ids: removed };
  };

  private handleListMethods: RPCHandler = () => {
    const catalog = listRpcMethods();
    const extensions = listRpcExtensionHandlers();
    if (extensions.length === 0) return catalog;
    return {
      version: catalog.version,
      methods: [...catalog.methods, ...extensions],
    };
  };

  private handleSnapshotTake: RPCHandler = () =>
    this.app.execute("take_snapshot", {});

  private handleOverlayMarkAtom: RPCHandler = async (params) => {
    const rawId = params.anchorAtomId;
    if (typeof rawId !== "number" || !Number.isInteger(rawId) || rawId < 0) {
      throw invalidParams(
        "overlay.mark_atom requires 'anchorAtomId' as a non-negative integer",
      );
    }
    if ("position" in params) {
      throw invalidParams(
        "overlay.mark_atom does not accept a 'position' — atoms are identified by id, not coordinates",
      );
    }
    const overlay = (await Promise.resolve(
      this.app.execute<MarkAtomProps, MarkAtomOverlay>(
        "mark_atom",
        params as unknown as MarkAtomProps,
      ),
    )) as MarkAtomOverlay;
    return { id: overlay.id };
  };

  private handleOverlayUnmarkAtom: RPCHandler = async (params) => {
    const id = requireString(params.id, "id");
    if (!id) {
      throw invalidParams("overlay.unmark_atom requires an 'id'");
    }
    await Promise.resolve(this.app.execute("unmark_atom", { id }));
    return { success: true };
  };

  private handleSetStyle: RPCHandler = async (params) => {
    try {
      // applyGlobalStyle already does a single fullRebuild — do not call
      // rebuildCurrentFrame again (that was the multi-flash bug).
      await applyGlobalStyle(this.app, params);
    } catch (error) {
      if (error instanceof RPCError) {
        throw error;
      }
      throw invalidParams(
        error instanceof Error ? error.message : String(error),
      );
    }
    return { success: true };
  };

  private handleSetTheme: RPCHandler = async (params) => {
    const p = asRecord(params);
    const name = String(p.theme ?? "")
      .trim()
      .toLowerCase();
    let themeInst: ClassicTheme | ModernTheme | VividTheme;
    switch (name) {
      case "classic":
        themeInst = new ClassicTheme();
        break;
      case "modern":
        themeInst = new ModernTheme();
        break;
      case "vivid":
        themeInst = new VividTheme();
        break;
      default:
        throw invalidParams(
          `theme must be one of 'classic', 'modern', 'vivid'; got '${String(p.theme)}'`,
        );
    }
    // Palette only — StyleManager atom/bond colors. Viewport background is
    // independent (host / view.set_background); never couple theme to clearColor.
    this.app.styleManager.setTheme(themeInst);
    // Canvas truth is SceneIndex (edit-pool place/draw + pipeline HEAD).
    // Pipeline rebuild alone only recolors DS-sourced atoms and misses
    // `scene.draw_frame` stamps — recolor impostor buffers from the theme.
    this.app.artist.recolorFromTheme();
    // When HEAD has structure, also re-run the pipeline so Draw modifiers
    // stay consistent with the new theme.
    const frame = this.app.frame;
    const nAtoms = frame?.getBlock("atoms")?.nrows() ?? 0;
    if (nAtoms > 0) {
      await this.app.applyPipeline({ fullRebuild: true, changeKind: "full" });
    }
    this.app.world.renderOnce();
    return { success: true, theme: name };
  };

  private handleSetMode: RPCHandler = (params) => {
    const mode = String(params.mode ?? "");
    if (!["view", "select", "edit", "measure", "manipulate"].includes(mode)) {
      throw invalidParams(
        "mode must be one of 'view', 'select', 'edit', 'measure', or 'manipulate'",
      );
    }
    this.app.setMode(mode);
    return { success: true };
  };

  // ---------------------------------------------------------------------
  // Pipeline (modifier CRUD) — mirrors the React sidebar so a controller
  // can manage the pipeline without scraping the DOM.
  // ---------------------------------------------------------------------

  private handlePipelineList: RPCHandler = () => {
    return {
      modifiers: this.app.modifierPipeline.getEntries().map(serializeEntry),
    };
  };

  private handlePipelineAvailableModifiers: RPCHandler = () => {
    return {
      modifiers: ModifierRegistry.getAvailableModifiers().map((entry) => ({
        name: entry.name,
        category: entry.category,
      })),
    };
  };

  private handlePipelineAddModifier: RPCHandler = async (params) => {
    const name = requireString(params.name, "name");
    if (!name) {
      throw invalidParams("pipeline.add_modifier requires a 'name'");
    }
    const entry = ModifierRegistry.getAvailableModifiers().find(
      (e) => e.name === name,
    );
    if (!entry) {
      throw invalidParams(`Unknown modifier: '${name}'`);
    }
    const modifier = entry.factory();
    this.app.modifierPipeline.addModifier(modifier);

    const scopeRaw = params.selection_scope_id ?? null;
    if (scopeRaw !== null && scopeRaw !== undefined) {
      const selectionScopeId = requireString(scopeRaw, "selection_scope_id");
      if (
        selectionScopeId &&
        !this.app.modifierPipeline.setSelectionScope(
          modifier.id,
          selectionScopeId,
        )
      ) {
        throw invalidParams(
          `Cannot set selection scope '${selectionScopeId}' on '${modifier.id}' — rejected by pipeline`,
        );
      }
    }

    const ownerRaw = params.source_owner_id ?? null;
    if (ownerRaw !== null && ownerRaw !== undefined) {
      const sourceOwnerId = requireString(ownerRaw, "source_owner_id");
      if (
        sourceOwnerId &&
        !this.app.modifierPipeline.setSourceOwner(modifier.id, sourceOwnerId)
      ) {
        throw invalidParams(
          `Cannot set source owner '${sourceOwnerId}' on '${modifier.id}' — rejected by pipeline`,
        );
      }
    }

    if (params.enabled !== undefined) {
      modifier.enabled = requireBoolean(params.enabled, "enabled");
    }

    await this.app.applyPipeline({ fullRebuild: true });
    return { id: modifier.id, modifier: serializeEntry(modifier) };
  };

  private handlePipelineRemoveModifier: RPCHandler = async (params) => {
    const id = requireString(params.id, "id");
    if (!id) {
      throw invalidParams("pipeline.remove_modifier requires an 'id'");
    }
    const removed = this.app.modifierPipeline.removeEntry(id);
    if (removed.length === 0) {
      throw invalidParams(`No modifier with id '${id}'`);
    }
    await this.app.applyPipeline({ fullRebuild: true });
    return { removed_ids: removed.map((m) => m.id) };
  };

  private handlePipelineReorderModifier: RPCHandler = async (params) => {
    const id = requireString(params.id, "id");
    const newIndex = requireInteger(params.new_index, "new_index");
    if (!id) {
      throw invalidParams("pipeline.reorder_modifier requires an 'id'");
    }
    if (!this.app.modifierPipeline.reorderEntry(id, newIndex)) {
      throw invalidParams(
        `Cannot reorder '${id}' to index ${newIndex} — out of range or unknown id`,
      );
    }
    await this.app.applyPipeline({ fullRebuild: true });
    return { success: true };
  };

  private handlePipelineSetEnabled: RPCHandler = async (params) => {
    const id = requireString(params.id, "id");
    const enabled = requireBoolean(params.enabled, "enabled");
    if (!id) {
      throw invalidParams("pipeline.set_enabled requires an 'id'");
    }
    const modifier = this.app.modifierPipeline
      .getEntries()
      .find((e) => e.id === id);
    if (!modifier) {
      throw invalidParams(`No modifier with id '${id}'`);
    }
    modifier.enabled = enabled;
    await this.app.applyPipeline({ fullRebuild: true });
    return { success: true };
  };

  private handlePipelineSetSelectionScope: RPCHandler = async (params) => {
    const id = requireString(params.id, "id");
    const raw = params.selection_scope_id;
    const selectionScopeId = requireString(raw, "selection_scope_id", {
      allowNull: true,
    });
    if (!id) {
      throw invalidParams("pipeline.set_selection_scope requires an 'id'");
    }
    if (!this.app.modifierPipeline.setSelectionScope(id, selectionScopeId)) {
      throw invalidParams(
        `Cannot set selection scope '${selectionScopeId}' on '${id}' — rejected by pipeline`,
      );
    }
    await this.app.applyPipeline({ fullRebuild: true });
    return { success: true };
  };

  private handlePipelineSetSourceOwner: RPCHandler = async (params) => {
    const id = requireString(params.id, "id");
    const raw = params.source_owner_id;
    const sourceOwnerId = requireString(raw, "source_owner_id", {
      allowNull: true,
    });
    if (!id) {
      throw invalidParams("pipeline.set_source_owner requires an 'id'");
    }
    if (!this.app.modifierPipeline.setSourceOwner(id, sourceOwnerId)) {
      throw invalidParams(
        `Cannot set source owner '${sourceOwnerId}' on '${id}' — rejected by pipeline`,
      );
    }
    await this.app.applyPipeline({ fullRebuild: true });
    return { success: true };
  };

  private handlePipelineClear: RPCHandler = async () => {
    this.app.modifierPipeline.clear();
    await this.app.applyPipeline({ fullRebuild: true });
    return { success: true };
  };

  // ---------------------------------------------------------------------
  // Multi-data-source commands
  // ---------------------------------------------------------------------

  private handleAddDataSource: RPCHandler = async (params, buffers) => {
    let frame: Frame;
    let filename: string;
    let contributedBlocks: string[] | undefined;

    try {
      const decoded = params;
      const rawFrame = decoded.frame;
      if (!rawFrame) {
        throw invalidParams("scene.add_data_source requires a 'frame' payload");
      }
      frame = decodeFrame(rawFrame, buffers, "scene.add_data_source frame");

      filename =
        requireString(decoded.filename, "filename", { allowNull: true }) ??
        this.sessionLabel();

      const rawBlocks = decoded.contributed_blocks;
      if (Array.isArray(rawBlocks)) {
        contributedBlocks = rawBlocks
          .filter((b): b is string => typeof b === "string")
          .slice();
      }
    } catch (error) {
      if (error instanceof RPCError) throw error;
      throw invalidParams(
        error instanceof Error ? error.message : String(error),
      );
    }

    const ds = new MemoryDataSource(frame, {
      sourceType: "backend",
      filename,
      contributedBlocks,
    });
    try {
      await this.app.addDataSource(ds);
    } catch (err) {
      ds.dispose();
      throw err instanceof Error ? invalidParams(err.message) : err;
    }
    return { success: true, id: ds.id };
  };

  /**
   * Cascade-remove a DataSource and its children. The id must
   * refer to a DS in the pipeline (use `pipeline.remove_modifier` for
   * non-DS modifiers). System trajectory is re-derived per the spec's
   * 1a delete-rebuild semantics.
   */
  private handleRemoveDataSource: RPCHandler = async (params) => {
    const id = requireString(params.id, "id");
    if (!id) {
      throw invalidParams("scene.remove_data_source requires an 'id'");
    }
    try {
      await this.app.removeDataSource(id);
    } catch (err) {
      throw invalidParams(err instanceof Error ? err.message : String(err));
    }
    return { success: true };
  };

  /**
   * List all DataSources in the pipeline with their kind,
   * filename, sourceType, frame count, and contributed-block summary.
   * Used by the Python backend to mirror UI state and by `state_sync`
   * for snapshot round-tripping.
   */
  private handleListDataSources: RPCHandler = async () => {
    const dsList = this.app.modifierPipeline.sources().map((ds) => ({
      id: ds.id,
      kind: ds.kind,
      filename: ds.filename,
      source_type: ds.sourceType,
      frame_count: ds.frameCount,
      contributed_blocks: [...ds.contributedBlocks],
      enabled: ds.enabled,
    }));
    return { data_sources: dsList };
  };

  // ---------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------

  /**
   * Build a display label for the DataSource. Anchors it to the
   * active trajectory's frame count (when > 1) so the sidebar surfaces a
   * hint like ``backend · 250 frames`` after a push.
   */
  private sessionLabel(frameCount?: number): string {
    const n = frameCount ?? this.app.system.trajectory?.length ?? 0;
    if (n > 1) return `backend · ${n} frames`;
    return "backend";
  }
}

/**
 * Geometric centroid of a frame's atoms (for PlaceMolecule absolute placement).
 * Coordinates come from molrs atom columns only — no frame surgery in molvis.
 */
function moleculeCentroid(frame: Frame): Vector3 {
  const atoms = frame.getBlock("atoms");
  if (!atoms || atoms.nrows() === 0) return Vector3.Zero();
  const coords = viewAtomCoords(atoms);
  if (!coords) return Vector3.Zero();
  const n = atoms.nrows();
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (let i = 0; i < n; i++) {
    cx += coords.x[i];
    cy += coords.y[i];
    cz += coords.z[i];
  }
  return new Vector3(cx / n, cy / n, cz / n);
}
