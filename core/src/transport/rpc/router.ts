/**
 * JSON-RPC router: dispatches inbound requests from a controller
 * (Python / other language) into `MolvisApp` commands and property
 * accessors. The single frontend router — no parallel anywidget copy.
 */

import { type Box, Frame } from "@molcrafts/molrs";
import type { MolvisApp } from "../../app";
import { ClassicTheme } from "../../artist/presets/classic";
import { ModernTheme } from "../../artist/presets/modern";
import {
  DataSourceModifier,
  FrameDataSource,
} from "../../pipeline/data_source_modifier";
import type { Modifier } from "../../pipeline/modifier";
import { ModifierRegistry } from "../../pipeline/modifier_registry";
import { Trajectory } from "../../system/trajectory";
import { buildBox, buildFrame, decodeBinaryPayload } from "./serialization";
import type {
  JsonRPCRequest,
  RPCResponseEnvelope,
  SerializedBoxData,
  SerializedFrameData,
} from "./types";
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

const LEGACY_ALIASES: Record<string, string> = {
  new_frame: "scene.new_frame",
  draw_frame: "scene.draw_frame",
  draw_box: "scene.draw_box",
  clear: "scene.clear",
  clear_scene: "scene.clear",
  export_frame: "scene.export_frame",
  get_selected: "selection.get",
  select_atoms: "selection.select_atoms",
  take_snapshot: "snapshot.take",
  set_style: "view.set_style",
  set_theme: "view.set_theme",
  set_view_mode: "view.set_mode",
};

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
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw invalidParams(`${label} must be a finite number`);
  }
  return value;
}

function toRepresentationName(style: unknown): string | null {
  switch (style) {
    case "ball_and_stick":
      return "Ball and Stick";
    case "spacefill":
      return "Spacefill";
    case "wireframe":
      return "Stick";
    default:
      return null;
  }
}

function toNumberArray(value: unknown): number[] | null {
  if (ArrayBuffer.isView(value)) {
    return Array.from(value as unknown as ArrayLike<number>, Number);
  }
  if (!Array.isArray(value)) {
    return null;
  }
  if (
    !value.every((item) => typeof item === "number" && Number.isFinite(item))
  ) {
    return null;
  }
  return value as number[];
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

function applyStyle(
  app: MolvisApp,
  params: Record<string, unknown>,
): { manualAtomRadii: number[] | null } {
  const styleName = toRepresentationName(params.style);
  if (params.style != null && !styleName) {
    throw invalidParams(
      "style must be one of 'ball_and_stick', 'spacefill', or 'wireframe'",
    );
  }
  if (styleName) {
    app.setRepresentation(styleName);
  }

  const atoms = asRecord(params.atoms);
  const bonds = asRecord(params.bonds);
  let manualAtomRadii: number[] | null = null;

  if (atoms.radius != null) {
    if (typeof atoms.radius === "number") {
      app.styleManager.setAtomRadiusScale(
        ensureFiniteNumber(atoms.radius, "atoms.radius"),
      );
    } else {
      manualAtomRadii = toNumberArray(atoms.radius);
      if (!manualAtomRadii) {
        throw invalidParams(
          "atoms.radius must be a finite number or an array of finite numbers",
        );
      }
    }
  }

  if (bonds.radius != null) {
    app.styleManager.setBondRadiusScale(
      ensureFiniteNumber(bonds.radius, "bonds.radius"),
    );
  }

  return { manualAtomRadii };
}

/**
 * Reapply the current source frame through the modifier pipeline. Used by
 * style / theme RPCs that mutate render-time state (radii, theme) without
 * changing the underlying data source.
 */
function rebuildCurrentFrame(app: MolvisApp): Promise<Frame | null> {
  if (!app.frame) return Promise.resolve(null);
  return app.applyPipeline({ fullRebuild: true });
}

/**
 * Ensure the pipeline has a ``DataSourceModifier`` — the single point of
 * ingress for both GUI ("Load File") and WS (``scene.draw_frame`` /
 * ``scene.set_trajectory``) data pushes. If one already exists we reuse
 * it so user-added downstream modifiers stay wired up; otherwise a fresh
 * one is inserted at the head of the pipeline.
 */
export function ensureDataSource(
  app: MolvisApp,
  meta: { sourceType: DataSourceModifier["sourceType"]; filename: string },
): DataSourceModifier {
  const pipeline = app.modifierPipeline;
  let dataSource = pipeline
    .getModifiers()
    .find((m): m is DataSourceModifier => m instanceof DataSourceModifier);

  if (!dataSource) {
    // Placeholder DS at pipeline head. Tasks #4–#5 of the multi-DS
    // spec replace this with a `addDataSource(spec)` flow that wraps
    // the actual loaded data; for now we install an empty
    // FrameDataSource so the pipeline always has a head marker.
    dataSource = new FrameDataSource(new Frame());
    pipeline.addModifier(dataSource);
    // Keep data source at the head — downstream modifiers read from its output.
    const currentIndex = pipeline
      .getModifiers()
      .findIndex((m) => m.id === dataSource?.id);
    if (currentIndex > 0) {
      pipeline.reorderModifier(dataSource.id, 0);
    }
  }

  dataSource.sourceType = meta.sourceType;
  dataSource.filename = meta.filename;
  return dataSource;
}

/** Serialize a modifier to the wire shape used by ``pipeline.*`` RPCs. */
function serializeModifier(modifier: Modifier): Record<string, unknown> {
  return {
    id: modifier.id,
    name: modifier.name,
    capabilities: Array.from(modifier.capabilities),
    enabled: modifier.enabled,
    parent_id: modifier.parentId,
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

export class RPCRouter {
  private readonly app: MolvisApp;
  private readonly handlers: Map<string, RPCHandler>;

  constructor(app: MolvisApp) {
    this.app = app;
    this.handlers = new Map<string, RPCHandler>([
      ["scene.new_frame", this.handleNewFrame],
      ["scene.draw_frame", this.handleDrawFrame],
      ["scene.draw_box", this.handleDrawBox],
      ["scene.clear", this.handleClear],
      ["scene.export_frame", this.handleExportFrame],
      ["scene.set_trajectory", this.handleSetTrajectory],
      ["scene.set_frame_labels", this.handleSetFrameLabels],
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
      ["pipeline.set_parent", this.handlePipelineSetParent],
      ["pipeline.clear", this.handlePipelineClear],
      ["scene.add_data_source", this.handleAddDataSource],
      ["scene.remove_data_source", this.handleRemoveDataSource],
      ["scene.list_data_sources", this.handleListDataSources],
      ["snapshot.take", this.handleSnapshotTake],
      ["view.set_style", this.handleSetStyle],
      ["view.set_theme", this.handleSetTheme],
      ["view.set_mode", this.handleSetMode],
      ["state.get", this.handleStateGet],
      ["overlay.mark_atom", this.handleMarkAtom],
      ["overlay.unmark_atom", this.handleUnmarkAtom],
    ]);
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

    const method = LEGACY_ALIASES[parsed.method] ?? parsed.method;
    const handler = this.handlers.get(method);

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
      return {
        content: createSuccessResponse(parsed.id, result),
      };
    } catch (error) {
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
      console.error("RPC execution failed", { method, error });
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
    ensureDataSource(this.app, {
      sourceType: "empty",
      filename: "",
    });
    await this.app.setTrajectory(new Trajectory([frame]));
    await this.app.applyPipeline({ fullRebuild: true });
    this.app.world.resetCamera();
    return { success: true };
  };

  private handleDrawFrame: RPCHandler = async (params, buffers) => {
    let frame: Frame;
    let box: Box | undefined;
    let manualAtomRadii: number[] | null;
    const sessionLabel = this.sessionLabel();

    try {
      const decoded = decodeBinaryPayload(params, buffers) as Record<
        string,
        unknown
      >;
      // Accept both "frame"/"frameData" and "box"/"boxData" for compatibility
      const rawFrame = decoded.frame ?? decoded.frameData;
      if (!rawFrame) {
        throw invalidParams("scene.draw_frame requires a 'frame' payload");
      }
      const frameData = asRecord(rawFrame) as unknown as SerializedFrameData;
      const rawBox = decoded.box ?? decoded.boxData;
      const boxData = rawBox
        ? (asRecord(rawBox) as unknown as SerializedBoxData)
        : null;
      const options = asRecord(decoded.options);
      frame = buildFrame(frameData);
      box = boxData ? buildBox(boxData) : undefined;
      ({ manualAtomRadii } = applyStyle(this.app, options));
    } catch (error) {
      if (error instanceof RPCError) {
        throw error;
      }
      throw invalidParams(
        error instanceof Error ? error.message : String(error),
      );
    }

    ensureDataSource(this.app, {
      sourceType: "backend",
      filename: sessionLabel,
    });
    await this.app.setTrajectory(new Trajectory([frame], [box]));
    await this.app.applyPipeline({ fullRebuild: true });
    this.app.world.resetCamera();

    // Per-atom radius override runs as a follow-up artist.drawFrame so
    // modifier effects (Hide, Color) from applyPipeline are preserved.
    if (manualAtomRadii && manualAtomRadii.length > 0) {
      const currentFrame = this.app.frame;
      if (currentFrame) {
        await this.app.artist.drawFrame(currentFrame, this.app.system.box, {
          atoms: { radii: manualAtomRadii },
        });
      }
    }
    return { success: true };
  };

  private handleDrawBox: RPCHandler = (params, buffers) => {
    let box: Box;
    try {
      const decoded = decodeBinaryPayload(params, buffers) as Record<
        string,
        unknown
      >;
      const rawBox = decoded.box ?? decoded.boxData;
      if (!rawBox) {
        throw invalidParams("scene.draw_box requires a 'box' payload");
      }
      box = buildBox(asRecord(rawBox) as unknown as SerializedBoxData);
    } catch (error) {
      if (error instanceof RPCError) {
        throw error;
      }
      throw invalidParams(
        error instanceof Error ? error.message : String(error),
      );
    }

    this.app.artist.drawBox(box);

    const currentFrame = this.app.frame;
    if (currentFrame) {
      this.app.system.updateCurrentFrame(currentFrame, box);
    }

    return { success: true };
  };

  private handleClear: RPCHandler = async () => {
    const frame = new Frame();
    ensureDataSource(this.app, {
      sourceType: "empty",
      filename: "",
    });
    await this.app.setTrajectory(new Trajectory([frame]));
    await this.app.applyPipeline({ fullRebuild: true });
    this.app.world.resetCamera();
    return { success: true };
  };

  private handleSetTrajectory: RPCHandler = async (params, buffers) => {
    const decoded = decodeBinaryPayload(params, buffers) as Record<
      string,
      unknown
    >;
    const rawFrames = decoded.frames;
    if (!Array.isArray(rawFrames) || rawFrames.length === 0) {
      throw invalidParams(
        "scene.set_trajectory requires a non-empty 'frames' array",
      );
    }
    const rawBoxes = Array.isArray(decoded.boxes) ? decoded.boxes : [];

    const frames: Frame[] = rawFrames.map((raw, i) => {
      try {
        return buildFrame(asRecord(raw) as unknown as SerializedFrameData);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw invalidParams(`frames[${i}]: ${message}`);
      }
    });

    const boxes: (Box | undefined)[] = rawBoxes.map((raw, i) => {
      if (raw == null) return undefined;
      try {
        return buildBox(asRecord(raw) as unknown as SerializedBoxData);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw invalidParams(`boxes[${i}]: ${message}`);
      }
    });

    const sessionLabel = this.sessionLabel(frames.length);
    ensureDataSource(this.app, {
      sourceType: "backend",
      filename: sessionLabel,
    });
    await this.app.setTrajectory(new Trajectory(frames, boxes));
    await this.app.applyPipeline({ fullRebuild: true });
    this.app.world.resetCamera();
    return { success: true, nFrames: frames.length };
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
    const decoded = decodeBinaryPayload(params, buffers) as Record<
      string,
      unknown
    >;

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
      const parent_id =
        typeof entry.parent_id === "string" ? entry.parent_id : null;
      return { id, name, capabilities, enabled, parent_id };
    });

    const rawFrames = Array.isArray(decoded.frames) ? decoded.frames : [];
    const frames: Frame[] = rawFrames.map((raw, i) => {
      try {
        return buildFrame(asRecord(raw) as unknown as SerializedFrameData);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw invalidParams(`scene.apply_state frames[${i}]: ${message}`);
      }
    });

    const rawBoxes = Array.isArray(decoded.boxes) ? decoded.boxes : [];
    const boxes: (Box | undefined)[] = rawBoxes.map((raw, i) => {
      if (raw == null) return undefined;
      try {
        return buildBox(asRecord(raw) as unknown as SerializedBoxData);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw invalidParams(`scene.apply_state boxes[${i}]: ${message}`);
      }
    });

    this.app.events.emit("backend-state-sync", {
      pipeline,
      frames,
      boxes,
    });

    return { success: true };
  };

  private handleSetFrameLabels: RPCHandler = (params, buffers) => {
    const decoded = decodeBinaryPayload(params, buffers) as Record<
      string,
      unknown
    >;
    const rawLabels = decoded.labels;
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
      let column: Float64Array;
      if (value instanceof Float64Array) {
        column = value;
      } else if (ArrayBuffer.isView(value)) {
        column = Float64Array.from(value as unknown as ArrayLike<number>);
      } else if (Array.isArray(value)) {
        column = Float64Array.from(value, (v) =>
          typeof v === "number" ? v : Number.NaN,
        );
      } else {
        throw invalidParams(`labels['${name}'] must be an array of numbers`);
      }
      if (nFrames > 0 && column.length !== nFrames) {
        throw invalidParams(
          `labels['${name}'] has length ${column.length}, expected ${nFrames}`,
        );
      }
      // Frame meta is the single source of truth — write per-frame via
      // molrs's setMeta. PCATool (and other consumers) walk the trajectory
      // at read time; no separate aggregation layer is stored.
      for (let i = 0; i < column.length; i++) {
        trajectory.get(i)?.setMeta(name, String(column[i]));
      }
      nLabels++;
    }

    this.app.events.emit("trajectory-change", trajectory);
    return { success: true, nLabels };
  };

  private handleExportFrame: RPCHandler = () => {
    const result = this.app.execute<
      Record<string, never>,
      {
        frameData: {
          blocks: Record<string, Record<string, unknown>>;
          metadata: Record<string, unknown>;
        };
      }
    >("export_frame", {});
    const resolved =
      result instanceof Promise ? result : Promise.resolve(result);
    return resolved.then((value) => ({
      frame: value.frameData,
    }));
  };

  private handleSelectionGet: RPCHandler = () =>
    this.app.execute("get_selected", {});

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
      mode: this.app.mode,
      frame_index: this.app.currentFrame,
      total_frames: this.app.system.trajectory?.length ?? 0,
    };
  };

  private handleSnapshotTake: RPCHandler = () =>
    this.app.execute("take_snapshot", {});

  private handleSetStyle: RPCHandler = async (params, buffers) => {
    let manualAtomRadii: number[] | null;
    try {
      const decoded = decodeBinaryPayload(params, buffers) as Record<
        string,
        unknown
      >;
      ({ manualAtomRadii } = applyStyle(this.app, decoded));
    } catch (error) {
      if (error instanceof RPCError) {
        throw error;
      }
      throw invalidParams(
        error instanceof Error ? error.message : String(error),
      );
    }

    const computed = await rebuildCurrentFrame(this.app);
    if (manualAtomRadii && manualAtomRadii.length > 0) {
      const target = computed ?? this.app.frame;
      if (target) {
        await this.app.artist.drawFrame(target, this.app.system.box, {
          atoms: { radii: manualAtomRadii },
        });
      }
    }
    return { success: true };
  };

  private handleSetTheme: RPCHandler = async (params) => {
    const frame = this.app.frame;
    const theme = params.theme;
    switch (theme) {
      case "classic":
      case "Classic":
        this.app.styleManager.setTheme(new ClassicTheme());
        break;
      case "modern":
      case "Modern":
        this.app.styleManager.setTheme(new ModernTheme());
        break;
      default:
        throw new Error(`Unsupported theme '${String(theme)}'`);
    }
    if (!frame) {
      return { success: true };
    }
    await rebuildCurrentFrame(this.app);
    return { success: true };
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
      modifiers: this.app.modifierPipeline
        .getModifiers()
        .map(serializeModifier),
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

    const parentIdRaw = params.parent_id ?? params.parentId ?? null;
    if (parentIdRaw !== null && parentIdRaw !== undefined) {
      const parentId = requireString(parentIdRaw, "parent_id");
      if (
        parentId &&
        !this.app.modifierPipeline.setParent(modifier.id, parentId)
      ) {
        throw invalidParams(
          `Cannot set parent '${parentId}' on '${modifier.id}' — rejected by pipeline`,
        );
      }
    }

    if (params.enabled !== undefined) {
      modifier.enabled = requireBoolean(params.enabled, "enabled");
    }

    await this.app.applyPipeline({ fullRebuild: true });
    return { id: modifier.id, modifier: serializeModifier(modifier) };
  };

  private handlePipelineRemoveModifier: RPCHandler = async (params) => {
    const id = requireString(params.id, "id");
    if (!id) {
      throw invalidParams("pipeline.remove_modifier requires an 'id'");
    }
    const removed = this.app.modifierPipeline.removeModifier(id);
    if (removed.length === 0) {
      throw invalidParams(`No modifier with id '${id}'`);
    }
    await this.app.applyPipeline({ fullRebuild: true });
    return { removed_ids: removed.map((m) => m.id) };
  };

  private handlePipelineReorderModifier: RPCHandler = async (params) => {
    const id = requireString(params.id, "id");
    const newIndex = requireInteger(
      params.new_index ?? params.newIndex,
      "new_index",
    );
    if (!id) {
      throw invalidParams("pipeline.reorder_modifier requires an 'id'");
    }
    if (!this.app.modifierPipeline.reorderModifier(id, newIndex)) {
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
      .getModifiers()
      .find((m) => m.id === id);
    if (!modifier) {
      throw invalidParams(`No modifier with id '${id}'`);
    }
    modifier.enabled = enabled;
    await this.app.applyPipeline({ fullRebuild: true });
    return { success: true };
  };

  private handlePipelineSetParent: RPCHandler = async (params) => {
    const id = requireString(params.id, "id");
    const parentIdRaw = params.parent_id ?? params.parentId;
    const parentId = requireString(parentIdRaw, "parent_id", {
      allowNull: true,
    });
    if (!id) {
      throw invalidParams("pipeline.set_parent requires an 'id'");
    }
    if (!this.app.modifierPipeline.setParent(id, parentId)) {
      throw invalidParams(
        `Cannot set parent '${parentId}' on '${id}' — rejected by pipeline`,
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
  // Multi-data-source commands (multi-data-source-pipeline spec phase 4)
  // ---------------------------------------------------------------------

  /**
   * Append a single-frame data source. The decoded frame is wrapped in
   * a {@link FrameDataSource} (broadcasts across the system's frame
   * count) and added via `MolvisApp.addDataSource`. Frame-count and
   * atom-count validations are enforced by `addDataSource` itself; on
   * mismatch the error propagates to the caller as a JSON-RPC error.
   *
   * For multi-frame appends, the backend should send each frame as a
   * separate `set_trajectory`-style payload — backend-driven trajectory
   * append is a future RPC.
   */
  private handleAddDataSource: RPCHandler = async (params, buffers) => {
    let frame: Frame;
    let filename: string;
    let contributedBlocks: string[] | undefined;

    try {
      const decoded = decodeBinaryPayload(params, buffers) as Record<
        string,
        unknown
      >;
      const rawFrame = decoded.frame ?? decoded.frameData;
      if (!rawFrame) {
        throw invalidParams("scene.add_data_source requires a 'frame' payload");
      }
      const frameData = asRecord(rawFrame) as unknown as SerializedFrameData;
      frame = buildFrame(frameData);

      filename =
        requireString(decoded.filename, "filename", { allowNull: true }) ??
        this.sessionLabel();

      const rawBlocks = decoded.contributed_blocks ?? decoded.contributedBlocks;
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

    const ds = new FrameDataSource(frame, {
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
   * Cascade-remove a DataSourceModifier and its children. The id must
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
   * List all DataSourceModifiers in the pipeline with their kind,
   * filename, sourceType, frame count, and contributed-block summary.
   * Used by the Python backend to mirror UI state and by `state_sync`
   * for snapshot round-tripping.
   */
  private handleListDataSources: RPCHandler = async () => {
    const dsList = this.app.modifierPipeline
      .getModifiers()
      .filter((m): m is DataSourceModifier => m instanceof DataSourceModifier)
      .map((ds) => ({
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
  // Overlay / annotation commands
  // ---------------------------------------------------------------------

  private handleMarkAtom: RPCHandler = async (params) => {
    const overlay = await Promise.resolve(
      this.app.execute<Record<string, unknown>, { id: string }>(
        "mark_atom",
        params,
      ),
    );
    return { id: overlay.id };
  };

  private handleUnmarkAtom: RPCHandler = (params) => {
    const id = requireString(params.id, "id");
    if (!id) {
      throw invalidParams("unmark_atom requires an 'id'");
    }
    this.app.execute("unmark_atom", { id });
    return { success: true };
  };

  // ---------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------

  /**
   * Build a display label for the DataSourceModifier. Anchors it to the
   * active trajectory's frame count (when > 1) so the sidebar surfaces a
   * hint like ``backend · 250 frames`` after a push.
   */
  private sessionLabel(frameCount?: number): string {
    const n = frameCount ?? this.app.system.trajectory?.length ?? 0;
    if (n > 1) return `backend · ${n} frames`;
    return "backend";
  }
}
