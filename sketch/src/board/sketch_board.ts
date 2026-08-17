import { CommandManager } from "@molcrafts/molvis-core/command";
import type { AppEventMap } from "@molcrafts/molvis-core/events";
import { EventEmitter } from "@molcrafts/molvis-core/events";
import type { Frame } from "@molcrafts/molvis-core/molrs";
import { isCtrlOrMeta } from "@molcrafts/molvis-core/platform";
import {
  SetAtomColorCommand,
  SetBondColorCommand,
} from "../commands/appearance_commands";
import { CompositeCommand } from "../commands/composite_command";
import { DeleteSelectionCommand } from "../commands/delete_selection_command";
import {
  AddAtomCommand,
  AddBondCommand,
  RemoveAtomCommand,
  RemoveBondCommand,
} from "../commands/edit_commands";
import {
  AdjustAtomChargeCommand,
  ClearDocumentCommand,
  CycleBondOrderCommand,
  MoveSelectionCommand,
  PlaceRingCommand,
  SetAtomElementCommand,
  SetBondOrderCommand,
  SetBondStereoCommand,
} from "../commands/ops_commands";
import { PlaceBondFromPointCommand } from "../commands/place_bond_from_point_command";
import {
  PlaceChainCommand,
  PlaceChainFromPointCommand,
} from "../commands/place_chain_command";
import { PlaceFragmentCommand } from "../commands/place_fragment_command";
import { PlaceTerminalBondCommand } from "../commands/place_terminal_bond_command";
import {
  type SketchExportOptions,
  SketchImageExporter,
} from "../export/sketch_image_exporter";
import { buildChainPoints } from "../geometry/chain_builder";
import {
  DEFAULT_FRAGMENT_ID,
  type FragmentTemplate,
  getFragmentTemplate,
} from "../geometry/fragment_templates";
import { buildRingTemplate, type RingKind } from "../geometry/ring_template";
import {
  CONNECT_SNAP_RADIUS,
  DEFAULT_BOND_LENGTH,
  findAtom,
  resolveBondTarget,
  SNAP_RADIUS,
  snapDirection,
} from "../geometry/snap";
import { MoleculeGraph } from "../molecule_graph";
import type { SketchCommand } from "../sketch_command";
import {
  DEFAULT_CUSTOM_COLOR,
  normalizeSketchColor,
} from "../style/custom_color";
import type { MoleculeData } from "../types";
import { DEFAULT_BOND_SCREEN_PX, ViewportCoords } from "./coords";
import { type BoardHit, HitTester } from "./hit_test";
import { resolveKeymap } from "./keymap";
import { SketchRenderer, type SketchRenderTheme } from "./sketch_renderer";
import { ViewportController } from "./viewport";

/** Active drawing tool. */
export type SketchTool =
  | "atom"
  | "bond"
  | "select"
  | "erase"
  | "ring"
  | "chain"
  | "charge"
  | "stereo"
  | "fragment";

export interface SketchBoardOptions {
  /** Atom hit radius at the default zoom. Default SNAP_RADIUS (0.42). */
  atomRadiusDoc?: number;
  /** Omit letter "C" on carbon atoms. Default true. */
  omitCarbonLabel?: boolean;
  /** Chain bond length in document units. Default 1.0. */
  bondChainStep?: number;
}

/** Observable editor state for host toolbars and status surfaces. */
export interface SketchBoardState {
  tool: SketchTool;
  element: string;
  bondOrder: 1 | 2 | 3;
  ringSize: number;
  ringKind: RingKind;
  /** Active fragment template id when using the fragment tool. */
  fragmentId: string;
  stereoMode: "none" | "up" | "down";
  chargeDelta: 1 | -1;
  customColor: string;
  colorOverrideEnabled: boolean;
  disabled: boolean;
  canUndo: boolean;
  canRedo: boolean;
  atomCount: number;
  bondCount: number;
  selectedAtomCount: number;
  selectedBondCount: number;
}

type Point = { x: number; y: number };

interface BondGesture {
  startAtom: number | null;
  start: Point;
  current: Point;
}

interface MarqueeGesture {
  start: Point;
  current: Point;
}

interface MoveGesture {
  start: Point;
  current: Point;
  atoms: number[];
}

/**
 * Canvas-backed 2D molecule sketch board.
 *
 * Coordinates: document units are Å-like; pointer events use CSS pixels.
 * Chain drags place a 120° carbon zig-zag at {@link bondChainStep} spacing as
 * one undo step.
 */
export class SketchBoard {
  readonly graph = new MoleculeGraph();
  /** Announces `history-change`; also what makes this board a `CommandHost`. */
  readonly events = new EventEmitter<AppEventMap>();
  readonly history = new CommandManager(this);
  readonly viewport = new ViewportCoords();
  readonly renderer = new SketchRenderer();
  readonly viewportCtrl = new ViewportController(this.viewport);

  private readonly atomRadiusDoc: number;
  private readonly omitCarbonLabel: boolean;
  private readonly bondChainStep: number;

  private canvas: HTMLCanvasElement | null = null;
  private tool: SketchTool = "atom";
  private element = "C";
  private bondOrder: 1 | 2 | 3 = 1;
  private ringSize = 6;
  private ringKind: RingKind = "benzene";
  private fragmentId = DEFAULT_FRAGMENT_ID;
  private stereoMode: "none" | "up" | "down" = "up";
  private chargeDelta: 1 | -1 = 1;
  private customColor: string = DEFAULT_CUSTOM_COLOR;
  private colorOverrideEnabled = false;
  private disabled = false;
  private selectedAtoms = new Set<number>();
  private selectedBonds = new Set<number>();
  private dirty = false;
  private raf = 0;
  private readonly stateListeners = new Set<
    (state: SketchBoardState) => void
  >();

  private activePointerId: number | null = null;
  private pointerDoc: Point | null = null;
  private hover: BoardHit = { kind: "none" };
  private bondGesture: BondGesture | null = null;
  private spacePan = false;
  private panning = false;
  private lastPan: { x: number; y: number } | null = null;
  private marqueeGesture: MarqueeGesture | null = null;
  private moveGesture: MoveGesture | null = null;
  private elementPrefix: { key: "b" | "c" | "s"; at: number } | null = null;
  private readonly onPointerDown = (e: PointerEvent) =>
    this.handlePointerDown(e);
  private readonly onPointerMove = (e: PointerEvent) =>
    this.handlePointerMove(e);
  private readonly onPointerUp = (e: PointerEvent) => this.handlePointerUp(e);
  private readonly onPointerCancel = (e: PointerEvent) =>
    this.handlePointerCancel(e);
  private readonly onPointerLeave = () => {
    if (this.activePointerId !== null) return;
    const changed = this.pointerDoc !== null || this.hover.kind !== "none";
    this.pointerDoc = null;
    this.hover = { kind: "none" };
    if (changed) this.markDirty();
  };
  private readonly onKeyDown = (e: KeyboardEvent) => this.handleKeyDown(e);
  private readonly onWindowKeyUp = (e: KeyboardEvent) => {
    if (e.key !== " ") return;
    this.spacePan = false;
    this.updateCursor();
  };
  private readonly onWindowBlur = () => {
    this.spacePan = false;
    this.cancelTransientGesture();
    this.updateCursor();
    this.markDirty();
  };
  private readonly onWheel = (e: WheelEvent) => {
    if (!this.canvas || this.disabled) return;
    e.preventDefault();
    const rect = this.canvas.getBoundingClientRect();
    const deltaCss =
      e.deltaMode === WheelEvent.DOM_DELTA_LINE
        ? e.deltaY * 16
        : e.deltaMode === WheelEvent.DOM_DELTA_PAGE
          ? e.deltaY * rect.height
          : e.deltaY;
    const factor = Math.exp(-deltaCss * 0.0015);
    this.viewportCtrl.zoomAtScreen(
      e.clientX - rect.left,
      e.clientY - rect.top,
      factor,
    );
    this.markDirty();
  };

  constructor(options: SketchBoardOptions = {}) {
    if (
      options.atomRadiusDoc !== undefined &&
      (!Number.isFinite(options.atomRadiusDoc) || options.atomRadiusDoc <= 0)
    ) {
      throw new Error("atomRadiusDoc must be a positive finite number");
    }
    if (
      options.bondChainStep !== undefined &&
      (!Number.isFinite(options.bondChainStep) || options.bondChainStep <= 0)
    ) {
      throw new Error("bondChainStep must be a positive finite number");
    }
    // Hit disk ≥ SNAP so pointer "magnetism" matches geometry snap.
    this.atomRadiusDoc = options.atomRadiusDoc ?? SNAP_RADIUS;
    this.omitCarbonLabel = options.omitCarbonLabel ?? true;
    this.bondChainStep = options.bondChainStep ?? DEFAULT_BOND_LENGTH;
  }

  mount(canvas: HTMLCanvasElement): void {
    if (this.canvas) this.unmount();
    this.canvas = canvas;
    canvas.tabIndex = this.disabled ? -1 : 0;
    canvas.setAttribute("aria-disabled", String(this.disabled));
    canvas.style.touchAction = "none";
    canvas.addEventListener("pointerdown", this.onPointerDown);
    canvas.addEventListener("pointermove", this.onPointerMove);
    canvas.addEventListener("pointerup", this.onPointerUp);
    canvas.addEventListener("pointercancel", this.onPointerCancel);
    canvas.addEventListener("pointerleave", this.onPointerLeave);
    canvas.addEventListener("keydown", this.onKeyDown);
    canvas.addEventListener("wheel", this.onWheel, { passive: false });
    window.addEventListener("keyup", this.onWindowKeyUp);
    window.addEventListener("blur", this.onWindowBlur);
    const rect = canvas.getBoundingClientRect();
    this.resize(rect.width || 300, rect.height || 200);
    this.updateCursor();
    this.markDirty();
  }

  unmount(): void {
    if (!this.canvas) return;
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    this.canvas.removeEventListener("pointermove", this.onPointerMove);
    this.canvas.removeEventListener("pointerup", this.onPointerUp);
    this.canvas.removeEventListener("pointercancel", this.onPointerCancel);
    this.canvas.removeEventListener("pointerleave", this.onPointerLeave);
    this.canvas.removeEventListener("keydown", this.onKeyDown);
    this.canvas.removeEventListener("wheel", this.onWheel);
    window.removeEventListener("keyup", this.onWindowKeyUp);
    window.removeEventListener("blur", this.onWindowBlur);
    this.cancelTransientGesture();
    if (this.raf) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    }
    this.canvas = null;
    this.dirty = false;
  }

  resize(cssWidth: number, cssHeight: number): void {
    const dpr =
      typeof globalThis.devicePixelRatio === "number"
        ? globalThis.devicePixelRatio
        : 1;
    this.viewport.resize(cssWidth, cssHeight, dpr);
    if (this.canvas) {
      const { width, height } = this.viewport.getBackingStoreSize();
      if (this.canvas.width !== width) this.canvas.width = width;
      if (this.canvas.height !== height) this.canvas.height = height;
      const styleWidth = `${cssWidth}px`;
      const styleHeight = `${cssHeight}px`;
      if (this.canvas.style.width !== styleWidth) {
        this.canvas.style.width = styleWidth;
      }
      if (this.canvas.style.height !== styleHeight) {
        this.canvas.style.height = styleHeight;
      }
    }
    this.markDirty();
  }

  setTool(tool: SketchTool): void {
    const resetChainOrder = tool === "chain" && this.bondOrder !== 1;
    if (resetChainOrder) this.bondOrder = 1;
    if (this.tool === tool) {
      this.cancelTransientGesture();
      this.updateCursor();
      if (resetChainOrder) this.emitState();
      this.markDirty();
      return;
    }
    this.tool = tool;
    this.cancelTransientGesture();
    this.updateCursor();
    this.emitState();
    this.markDirty();
  }

  getTool(): SketchTool {
    return this.tool;
  }

  setElement(symbol: string): void {
    const next = symbol.trim() || "C";
    if (this.element === next) return;
    this.element = next;
    this.emitState();
  }

  getElement(): string {
    return this.element;
  }

  setBondOrder(order: 1 | 2 | 3): void {
    const next = this.tool === "chain" ? 1 : order;
    if (this.bondOrder === next) return;
    this.bondOrder = next;
    this.emitState();
  }

  getBondOrder(): 1 | 2 | 3 {
    return this.bondOrder;
  }

  setTheme(theme: Partial<SketchRenderTheme>): void {
    this.renderer.setTheme(theme);
    this.markDirty();
  }

  clear(): void {
    if (
      this.disabled ||
      (this.graph.atomCount() === 0 && this.graph.bondCount() === 0)
    ) {
      return;
    }
    this.executeCommand(new ClearDocumentCommand(this.graph));
    this.clearSelection();
    this.emitState();
  }

  setRingTemplate(size: number, kind: RingKind = "aliphatic"): void {
    if (size < 3 || size > 8) {
      throw new Error(`ring size must be 3..8, got ${size}`);
    }
    if (this.ringSize === size && this.ringKind === kind) return;
    this.ringSize = size;
    this.ringKind = kind;
    this.emitState();
  }

  /**
   * Select the active fragment template for the fragment tool.
   * Unknown ids are rejected.
   */
  setFragmentTemplate(id: string): void {
    const template = getFragmentTemplate(id);
    if (!template) {
      throw new Error(`unknown fragment template: ${id}`);
    }
    if (this.fragmentId === template.id) return;
    this.fragmentId = template.id;
    this.emitState();
  }

  getFragmentTemplate(): FragmentTemplate {
    const template = getFragmentTemplate(this.fragmentId);
    if (template) return template;
    const fallback = getFragmentTemplate(DEFAULT_FRAGMENT_ID);
    if (!fallback) {
      throw new Error(
        `default fragment template missing: ${DEFAULT_FRAGMENT_ID}`,
      );
    }
    return fallback;
  }

  setStereoMode(mode: "none" | "up" | "down"): void {
    if (this.stereoMode === mode) return;
    this.stereoMode = mode;
    this.emitState();
  }

  setChargeDelta(delta: number): void {
    const next = delta >= 0 ? 1 : -1;
    if (this.chargeDelta === next) return;
    this.chargeDelta = next;
    this.emitState();
  }

  setCustomColor(color: string): void {
    const next = normalizeSketchColor(color);
    if (this.customColor === next) return;
    this.customColor = next;
    this.emitState();
    this.markDirty();
  }

  setColorOverrideEnabled(enabled: boolean): void {
    if (this.colorOverrideEnabled === enabled) return;
    this.colorOverrideEnabled = enabled;
    this.emitState();
    this.markDirty();
  }

  /** Apply or clear color overrides on the current selection as one undo step. */
  applyColorToSelection(
    color: string | null = this.colorOverrideEnabled ? this.customColor : null,
  ): boolean {
    if (this.disabled) return false;
    const next = color === null ? undefined : normalizeSketchColor(color);
    const commands = this.colorCommands(
      [...this.selectedAtoms],
      [...this.selectedBonds],
      next,
    );
    return this.executeCommands(commands);
  }

  /**
   * Disable all canvas mutation and navigation, including shortcuts that were
   * focused before a host operation entered its busy state.
   */
  setDisabled(disabled: boolean): void {
    if (this.disabled === disabled) return;
    this.disabled = disabled;
    if (this.canvas) {
      this.canvas.tabIndex = disabled ? -1 : 0;
      this.canvas.setAttribute("aria-disabled", String(disabled));
      if (disabled && document.activeElement === this.canvas) {
        this.canvas.blur();
      }
    }
    if (disabled) this.cancelTransientGesture();
    this.updateCursor();
    this.emitState();
    this.markDirty();
  }

  /** Snapshot the state needed by a host toolbar. */
  getState(): SketchBoardState {
    return {
      tool: this.tool,
      element: this.element,
      bondOrder: this.bondOrder,
      ringSize: this.ringSize,
      ringKind: this.ringKind,
      fragmentId: this.fragmentId,
      stereoMode: this.stereoMode,
      chargeDelta: this.chargeDelta,
      customColor: this.customColor,
      colorOverrideEnabled: this.colorOverrideEnabled,
      disabled: this.disabled,
      canUndo: this.history.canUndo(),
      canRedo: this.history.canRedo(),
      atomCount: this.graph.atomCount(),
      bondCount: this.graph.bondCount(),
      selectedAtomCount: this.selectedAtoms.size,
      selectedBondCount: this.selectedBonds.size,
    };
  }

  /**
   * Observe editor state. The current snapshot is delivered immediately.
   * Returns an unsubscribe callback.
   */
  subscribe(listener: (state: SketchBoardState) => void): () => void {
    this.stateListeners.add(listener);
    listener(this.getState());
    return () => {
      this.stateListeners.delete(listener);
    };
  }

  /**
   * Place the current ring template at document center (cx, cy).
   * Size is always derived from DEFAULT_BOND_LENGTH (RDKit-style), not a free radius.
   */
  placeRingAt(cx: number, cy: number): void {
    this.executeCommand(
      new PlaceRingCommand(
        this.graph,
        this.ringSize,
        cx,
        cy,
        DEFAULT_BOND_LENGTH,
        this.ringKind,
        -Math.PI / 2,
        false,
        this.activeColor(),
      ),
    );
  }

  /**
   * Place the active fragment at (cx, cy). When `targetAtom` is set, attach
   * with the template's attach mode (merge root or bond-from-target).
   */
  placeFragmentAt(
    cx: number,
    cy: number,
    targetAtom?: number,
    bondDir?: { x: number; y: number },
  ): void {
    const template = this.getFragmentTemplate();
    this.executeCommand(
      new PlaceFragmentCommand(this.graph, template, {
        x: cx,
        y: cy,
        targetAtom,
        bondDir,
        color: this.activeColor(),
      }),
    );
  }

  fitToView(): void {
    const data = this.graph.getMoleculeData();
    this.viewportCtrl.fitToAtoms(data.atoms);
    this.markDirty();
  }

  undo(): void {
    if (this.disabled) return;
    // Synchronous: core's history stays sync for synchronous commands.
    if (this.history.undo()) {
      this.clearSelection();
      this.cancelTransientGesture();
      this.emitState();
      this.markDirty();
    }
  }

  redo(): void {
    if (this.disabled) return;
    // Synchronous: core's history stays sync for synchronous commands.
    if (this.history.redo()) {
      this.clearSelection();
      this.cancelTransientGesture();
      this.emitState();
      this.markDirty();
    }
  }

  getMoleculeData(): MoleculeData {
    return this.graph.getMoleculeData();
  }

  loadMoleculeData(data: MoleculeData): void {
    this.graph.loadMoleculeData(data);
    // A loaded document is a new history root. Commands captured against the
    // previous graph must never be allowed to mutate it.
    this.history.clearHistory();
    this.clearSelection();
    this.cancelTransientGesture();
    this.emitState();
    this.markDirty();
  }

  toFrame(): Frame {
    return this.graph.toFrame();
  }

  /** Serialize a fitted, selection-free vector image of the current sketch. */
  toSvg(options: SketchExportOptions = {}): string {
    return new SketchImageExporter(
      this.graph,
      this.renderer.getTheme(),
      this.omitCarbonLabel,
    ).toSvg(options);
  }

  /** Encode a fitted, selection-free PNG image of the current sketch. */
  toPng(options: SketchExportOptions = {}): Promise<Blob> {
    return new SketchImageExporter(
      this.graph,
      this.renderer.getTheme(),
      this.omitCarbonLabel,
    ).toPng(options);
  }

  /** Force a paint (tests). */
  paintNow(): void {
    this.dirty = false;
    if (this.raf) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    }
    this.paint();
  }

  /** Whether a paint is scheduled (tests). */
  isPaintScheduled(): boolean {
    return this.raf !== 0;
  }

  markDirty(): void {
    this.dirty = true;
    if (this.raf || !this.canvas) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      if (!this.dirty) return;
      this.dirty = false;
      this.paint();
    });
  }

  private paint(): void {
    if (!this.canvas) return;
    const ctx = this.canvas.getContext("2d");
    if (!ctx) return;
    const gesturePreview = this.gesturePreviewPoints();
    this.renderer.paint(ctx, this.graph, this.viewport, {
      selectedAtoms: this.selectedAtoms,
      selectedBonds: this.selectedBonds,
      ...(this.hover.kind === "atom" ? { hoveredAtom: this.hover.index } : {}),
      ...(this.hover.kind === "bond" ? { hoveredBond: this.hover.index } : {}),
      omitCarbonLabel: this.omitCarbonLabel,
      atomRadiusDoc: this.atomRadiusDoc,
      ...(this.moveGesture
        ? {
            movePreview: {
              atomIndices: new Set(this.moveGesture.atoms),
              dx: this.moveGesture.current.x - this.moveGesture.start.x,
              dy: this.moveGesture.current.y - this.moveGesture.start.y,
            },
          }
        : {}),
      ...(this.marqueeGesture
        ? {
            marquee: {
              x0: this.marqueeGesture.start.x,
              y0: this.marqueeGesture.start.y,
              x1: this.marqueeGesture.current.x,
              y1: this.marqueeGesture.current.y,
            },
          }
        : {}),
      ...(gesturePreview.length >= 2
        ? {
            gesturePreview: {
              points: gesturePreview,
            },
          }
        : {}),
    });
  }

  private eventDoc(e: PointerEvent): { x: number; y: number } {
    if (!this.canvas) return { x: 0, y: 0 };
    const rect = this.canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    return this.viewport.screenToDoc(sx, sy);
  }

  private hitAt(doc: Point): BoardHit {
    // Keep hit areas roughly constant in CSS pixels while zooming.
    const zoomRatio = DEFAULT_BOND_SCREEN_PX / this.viewport.getScale();
    return new HitTester(
      this.atomRadiusDoc * zoomRatio,
      this.atomRadiusDoc * 0.55 * zoomRatio,
    ).hit(this.graph, doc.x, doc.y);
  }

  private handlePointerDown(e: PointerEvent): void {
    if (!this.canvas || this.disabled) return;
    if (this.activePointerId !== null || e.button === 2) return;
    this.canvas.focus();
    const doc = this.eventDoc(e);
    this.pointerDoc = doc;
    const hit = this.hitAt(doc);

    if (e.button === 1 || this.spacePan) {
      e.preventDefault();
      this.capturePointer(e);
      this.panning = true;
      this.lastPan = { x: e.clientX, y: e.clientY };
      this.updateCursor();
      return;
    }
    if (e.button !== 0) return;
    e.preventDefault();

    if (this.tool === "ring") {
      this.placeRingForHit(hit, doc);
      return;
    }

    if (this.tool === "fragment") {
      this.placeFragmentForHit(hit, doc);
      return;
    }

    if (this.tool === "charge" && hit.kind === "atom") {
      const commands: SketchCommand[] = [
        new AdjustAtomChargeCommand(this.graph, hit.index, this.chargeDelta),
      ];
      const color = this.activeColor();
      if (color) commands.push(...this.colorCommands([hit.index], [], color));
      this.executeCommands(commands);
      return;
    }

    if (this.tool === "stereo" && hit.kind === "bond") {
      const bond = this.graph.getBond(hit.index);
      if (bond.order === 1) {
        const commands: SketchCommand[] = [];
        if (bond.stereo !== this.stereoMode || this.stereoMode !== "none") {
          commands.push(
            new SetBondStereoCommand(this.graph, hit.index, this.stereoMode),
          );
        }
        const color = this.activeColor();
        if (color) {
          commands.push(...this.colorCommands([], [hit.index], color));
        }
        this.executeCommands(commands);
      }
      return;
    }

    if (this.tool === "bond") {
      if (hit.kind === "bond") {
        const bond = this.graph.getBond(hit.index);
        const commands: SketchCommand[] = [
          bond.order === this.bondOrder
            ? new CycleBondOrderCommand(this.graph, hit.index)
            : new SetBondOrderCommand(this.graph, hit.index, this.bondOrder),
        ];
        const color = this.activeColor();
        if (color) {
          commands.push(...this.colorCommands([], [hit.index], color));
        }
        this.executeCommands(commands);
        return;
      }
      this.capturePointer(e);
      this.bondGesture = {
        startAtom: hit.kind === "atom" ? hit.index : null,
        start: doc,
        current: doc,
      };
      this.markDirty();
      return;
    }

    if (this.tool === "chain") {
      this.capturePointer(e);
      this.bondGesture = {
        startAtom: hit.kind === "atom" ? hit.index : null,
        start: doc,
        current: doc,
      };
      this.markDirty();
      return;
    }

    if (this.tool === "atom") {
      if (hit.kind === "atom") {
        const atom = this.graph.getAtom(hit.index);
        const commands: SketchCommand[] = [];
        if (atom.element !== this.element) {
          commands.push(
            new SetAtomElementCommand(this.graph, hit.index, this.element),
          );
        }
        const color = this.activeColor();
        if (color) {
          commands.push(...this.colorCommands([hit.index], [], color));
        }
        this.executeCommands(commands);
        return;
      }
      // Do not create a disconnected atom over the middle of an existing bond.
      if (hit.kind === "bond") return;
      if (findAtom(this.graph, doc.x, doc.y, SNAP_RADIUS) !== null) return;
      {
        const color = this.activeColor();
        this.executeCommand(
          new AddAtomCommand(this.graph, {
            element: this.element,
            x: doc.x,
            y: doc.y,
            ...(color ? { color } : {}),
          }),
        );
      }
      return;
    }

    if (this.tool === "erase") {
      if (hit.kind === "atom") {
        this.executeCommand(new RemoveAtomCommand(this.graph, hit.index));
        this.clearSelection();
        this.emitState();
      } else if (hit.kind === "bond") {
        this.executeCommand(new RemoveBondCommand(this.graph, hit.index));
        this.selectedBonds.clear();
        this.emitState();
      }
      return;
    }

    if (this.tool === "select") {
      if (hit.kind === "atom") {
        if (e.shiftKey) {
          if (this.selectedAtoms.has(hit.index)) {
            this.selectedAtoms.delete(hit.index);
          } else {
            this.selectedAtoms.add(hit.index);
          }
        } else {
          if (!this.selectedAtoms.has(hit.index)) {
            this.clearSelection();
            this.selectedAtoms.add(hit.index);
          }
          this.capturePointer(e);
          this.moveGesture = {
            start: doc,
            current: doc,
            atoms: this.atomsForSelectionMove(),
          };
        }
      } else if (hit.kind === "bond") {
        if (e.shiftKey) {
          if (this.selectedBonds.has(hit.index)) {
            this.selectedBonds.delete(hit.index);
          } else {
            this.selectedBonds.add(hit.index);
          }
        } else {
          if (!this.selectedBonds.has(hit.index)) {
            this.clearSelection();
            this.selectedBonds.add(hit.index);
          }
          this.capturePointer(e);
          this.moveGesture = {
            start: doc,
            current: doc,
            atoms: this.atomsForSelectionMove(),
          };
        }
      } else {
        this.capturePointer(e);
        this.marqueeGesture = {
          start: doc,
          current: doc,
        };
        if (!e.shiftKey) {
          this.clearSelection();
        }
      }
      this.emitState();
      this.markDirty();
    }
  }

  private handlePointerMove(e: PointerEvent): void {
    if (this.disabled) return;
    if (this.activePointerId !== null && e.pointerId !== this.activePointerId) {
      return;
    }
    const doc = this.eventDoc(e);
    this.pointerDoc = doc;
    if (this.panning && this.lastPan) {
      e.preventDefault();
      this.viewportCtrl.panByScreen(
        e.clientX - this.lastPan.x,
        e.clientY - this.lastPan.y,
      );
      this.lastPan = { x: e.clientX, y: e.clientY };
      this.markDirty();
      return;
    }
    if (this.activePointerId === null) {
      const nextHover = this.hitAt(doc);
      if (!sameHit(this.hover, nextHover)) {
        this.hover = nextHover;
        this.markDirty();
      }
      return;
    }
    if (this.moveGesture) {
      this.moveGesture.current = doc;
      this.markDirty();
    } else if (this.marqueeGesture) {
      this.marqueeGesture.current = doc;
      this.markDirty();
    } else if (this.bondGesture) {
      this.bondGesture.current = doc;
      this.markDirty();
    }
  }

  private handlePointerUp(e: PointerEvent): void {
    if (!this.canvas || this.disabled) return;
    if (this.activePointerId !== null && e.pointerId !== this.activePointerId) {
      return;
    }
    e.preventDefault();
    const doc = this.eventDoc(e);
    this.releasePointer(e);

    if (this.panning) {
      this.panning = false;
      this.lastPan = null;
      this.updateCursor();
      return;
    }

    if (this.moveGesture) {
      const gesture = this.moveGesture;
      this.moveGesture = null;
      const dx = doc.x - gesture.start.x;
      const dy = doc.y - gesture.start.y;
      const dragThreshold = 2 / this.viewport.getScale();
      if (Math.hypot(dx, dy) > dragThreshold && gesture.atoms.length > 0) {
        this.executeCommand(
          new MoveSelectionCommand(this.graph, gesture.atoms, dx, dy),
        );
      } else {
        this.markDirty();
      }
      return;
    }

    if (this.marqueeGesture) {
      const gesture = this.marqueeGesture;
      this.marqueeGesture = null;
      const x0 = Math.min(gesture.start.x, doc.x);
      const x1 = Math.max(gesture.start.x, doc.x);
      const y0 = Math.min(gesture.start.y, doc.y);
      const y1 = Math.max(gesture.start.y, doc.y);
      const data = this.graph.getMoleculeData();
      const enclosedAtoms = new Set<number>();
      for (let i = 0; i < data.atoms.length; i++) {
        const a = data.atoms[i];
        if (a.x >= x0 && a.x <= x1 && a.y >= y0 && a.y <= y1) {
          enclosedAtoms.add(i);
          this.selectedAtoms.add(i);
        }
      }
      for (let index = 0; index < data.bonds.length; index++) {
        const bond = data.bonds[index];
        if (enclosedAtoms.has(bond.i) && enclosedAtoms.has(bond.j)) {
          this.selectedBonds.add(index);
        }
      }
      this.emitState();
      this.markDirty();
      return;
    }

    if (this.tool !== "bond" && this.tool !== "chain") return;
    const gesture = this.bondGesture;
    this.bondGesture = null;
    if (!gesture) return;

    if (this.tool === "chain") {
      const points = this.chainGesturePoints(gesture, doc);
      if (points.length < 3) {
        this.markDirty();
        return;
      }
      const start = gesture.startAtom;
      this.executeCommand(
        start === null
          ? new PlaceChainFromPointCommand(
              this.graph,
              gesture.start.x,
              gesture.start.y,
              doc.x,
              doc.y,
              this.bondChainStep,
              1,
              this.activeColor(),
            )
          : new PlaceChainCommand(
              this.graph,
              start,
              doc.x,
              doc.y,
              this.bondChainStep,
              1,
              this.activeColor(),
            ),
      );
      return;
    }

    // Prefer connect-snap over hit-test alone (magnetism when slightly off-center).
    const hit = this.hitAt(doc);
    const snapped =
      hit.kind === "atom"
        ? hit.index
        : findAtom(this.graph, doc.x, doc.y, CONNECT_SNAP_RADIUS);
    const start = gesture.startAtom;

    if (start === null) {
      this.executeCommand(
        new PlaceBondFromPointCommand(
          this.graph,
          gesture.start.x,
          gesture.start.y,
          doc.x,
          doc.y,
          this.bondOrder,
          "C",
          DEFAULT_BOND_LENGTH,
          this.activeColor(),
        ),
      );
      return;
    }

    if (snapped !== null && snapped !== start) {
      const existingBond = this.graph.findBondIndex(start, snapped);
      if (existingBond === null) {
        {
          const color = this.activeColor();
          this.executeCommand(
            new AddBondCommand(this.graph, {
              i: start,
              j: snapped,
              order: this.bondOrder,
              ...(color ? { color } : {}),
            }),
          );
        }
      } else {
        const bond = this.graph.getBond(existingBond);
        const commands: SketchCommand[] = [];
        if (bond.order !== this.bondOrder) {
          commands.push(
            new SetBondOrderCommand(this.graph, existingBond, this.bondOrder),
          );
        }
        const color = this.activeColor();
        if (color) {
          commands.push(...this.colorCommands([], [existingBond], color));
        }
        if (!this.executeCommands(commands)) this.markDirty();
      }
      return;
    }

    // Bond tool → empty: one terminal C at fixed length + 30° snap (not free chain).
    this.executeCommand(
      new PlaceTerminalBondCommand(
        this.graph,
        start,
        doc.x,
        doc.y,
        this.bondOrder,
        DEFAULT_BOND_LENGTH,
        this.activeColor(),
      ),
    );
  }

  private handlePointerCancel(e: PointerEvent): void {
    if (this.activePointerId !== null && e.pointerId !== this.activePointerId) {
      return;
    }
    this.releasePointer(e);
    this.cancelTransientGesture();
    this.updateCursor();
    this.markDirty();
  }

  private capturePointer(e: PointerEvent): void {
    this.activePointerId = e.pointerId;
    if (!this.canvas?.setPointerCapture) return;
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      // Synthetic PointerEvents used by hosts/tests may not be capturable.
    }
  }

  private releasePointer(e: PointerEvent): void {
    if (
      this.canvas?.releasePointerCapture &&
      this.canvas.hasPointerCapture?.(e.pointerId)
    ) {
      this.canvas.releasePointerCapture(e.pointerId);
    }
    this.activePointerId = null;
  }

  private cancelTransientGesture(): void {
    if (
      this.canvas?.releasePointerCapture &&
      this.activePointerId !== null &&
      this.canvas.hasPointerCapture?.(this.activePointerId)
    ) {
      this.canvas.releasePointerCapture(this.activePointerId);
    }
    this.activePointerId = null;
    this.bondGesture = null;
    this.marqueeGesture = null;
    this.moveGesture = null;
    this.panning = false;
    this.lastPan = null;
    this.hover = { kind: "none" };
    this.pointerDoc = null;
  }

  private atomsForSelectionMove(): number[] {
    const atoms = new Set(this.selectedAtoms);
    for (const bondIndex of this.selectedBonds) {
      const bond = this.graph.getBond(bondIndex);
      atoms.add(bond.i);
      atoms.add(bond.j);
    }
    return [...atoms].sort((a, b) => a - b);
  }

  private clearSelection(): void {
    this.selectedAtoms.clear();
    this.selectedBonds.clear();
  }

  private activeColor(): string | undefined {
    return this.colorOverrideEnabled ? this.customColor : undefined;
  }

  private colorCommands(
    atomIndices: number[],
    bondIndices: number[],
    color: string | undefined,
  ): SketchCommand[] {
    const commands: SketchCommand[] = [];
    for (const index of [...new Set(atomIndices)].sort((a, b) => a - b)) {
      if (this.graph.getAtom(index).color !== color) {
        commands.push(new SetAtomColorCommand(this.graph, index, color));
      }
    }
    for (const index of [...new Set(bondIndices)].sort((a, b) => a - b)) {
      if (this.graph.getBond(index).color !== color) {
        commands.push(new SetBondColorCommand(this.graph, index, color));
      }
    }
    return commands;
  }

  private executeCommands(commands: SketchCommand[]): boolean {
    if (commands.length === 0) return false;
    const command =
      commands.length === 1 ? commands[0] : new CompositeCommand(commands);
    this.executeCommand(command);
    return true;
  }

  private executeCommand(command: SketchCommand): void {
    if (this.disabled) return;
    this.history.execute(command);
    this.hover = { kind: "none" };
    this.emitState();
    this.markDirty();
  }

  private emitState(): void {
    if (this.stateListeners.size === 0) return;
    const state = this.getState();
    for (const listener of [...this.stateListeners]) listener(state);
  }

  private updateCursor(): void {
    if (!this.canvas) return;
    if (this.disabled) {
      this.canvas.style.cursor = "not-allowed";
      return;
    }
    if (this.panning) {
      this.canvas.style.cursor = "grabbing";
      return;
    }
    if (this.spacePan) {
      this.canvas.style.cursor = "grab";
      return;
    }
    this.canvas.style.cursor =
      this.tool === "select"
        ? "default"
        : this.tool === "erase"
          ? "cell"
          : "crosshair";
  }

  private gesturePreviewPoints(): Point[] {
    const gesture = this.bondGesture;
    if (!gesture) return [];
    const start =
      gesture.startAtom === null
        ? gesture.start
        : this.graph.getAtom(gesture.startAtom);

    if (this.tool === "bond") {
      if (gesture.startAtom !== null) {
        const target = resolveBondTarget(
          this.graph,
          gesture.startAtom,
          gesture.current.x,
          gesture.current.y,
          DEFAULT_BOND_LENGTH,
        );
        const end =
          target.existingIndex === null
            ? target
            : this.graph.getAtom(target.existingIndex);
        return [
          { x: start.x, y: start.y },
          { x: end.x, y: end.y },
        ];
      }
      const snapped = findAtom(
        this.graph,
        gesture.current.x,
        gesture.current.y,
        CONNECT_SNAP_RADIUS,
      );
      if (snapped !== null) {
        const atom = this.graph.getAtom(snapped);
        return [
          { x: start.x, y: start.y },
          { x: atom.x, y: atom.y },
        ];
      }
      const { ux, uy } = snapDirection(
        gesture.current.x - start.x,
        gesture.current.y - start.y,
      );
      return [
        { x: start.x, y: start.y },
        {
          x: start.x + ux * DEFAULT_BOND_LENGTH,
          y: start.y + uy * DEFAULT_BOND_LENGTH,
        },
      ];
    }

    if (this.tool !== "chain") return [];
    return this.chainGesturePoints(gesture, gesture.current);
  }

  private chainGesturePoints(gesture: BondGesture, end: Point): Point[] {
    const start =
      gesture.startAtom === null
        ? gesture.start
        : this.graph.getAtom(gesture.startAtom);
    return [
      { x: start.x, y: start.y },
      ...buildChainPoints(start.x, start.y, end.x, end.y, this.bondChainStep)
        .points,
    ];
  }

  private awayDirectionFromAtom(atomIndex: number): Point {
    const data = this.graph.getMoleculeData();
    const anchor = data.atoms[atomIndex];
    let neighborX = 0;
    let neighborY = 0;
    for (const bond of data.bonds) {
      const neighborIndex =
        bond.i === atomIndex ? bond.j : bond.j === atomIndex ? bond.i : null;
      if (neighborIndex === null) continue;
      const neighbor = data.atoms[neighborIndex];
      const dx = neighbor.x - anchor.x;
      const dy = neighbor.y - anchor.y;
      const length = Math.hypot(dx, dy) || 1;
      neighborX += dx / length;
      neighborY += dy / length;
    }
    const awayX = -neighborX;
    const awayY = -neighborY;
    const awayLength = Math.hypot(awayX, awayY);
    if (awayLength < 1e-6) {
      return { x: 1, y: 0 };
    }
    return { x: awayX / awayLength, y: awayY / awayLength };
  }

  private placeFragmentForHit(hit: BoardHit, doc: Point): void {
    if (hit.kind === "atom") {
      const away = this.awayDirectionFromAtom(hit.index);
      this.placeFragmentAt(doc.x, doc.y, hit.index, away);
      return;
    }
    this.placeFragmentAt(doc.x, doc.y);
  }

  private placeRingForHit(hit: BoardHit, doc: Point): void {
    if (hit.kind === "atom") {
      const data = this.graph.getMoleculeData();
      const anchor = data.atoms[hit.index];
      const away = this.awayDirectionFromAtom(hit.index);
      const radius =
        DEFAULT_BOND_LENGTH / (2 * Math.sin(Math.PI / this.ringSize));
      const cx = anchor.x + away.x * radius;
      const cy = anchor.y + away.y * radius;
      const anchorAngle = Math.atan2(anchor.y - cy, anchor.x - cx);
      this.executeCommand(
        new PlaceRingCommand(
          this.graph,
          this.ringSize,
          cx,
          cy,
          DEFAULT_BOND_LENGTH,
          this.ringKind,
          anchorAngle,
          false,
          this.activeColor(),
        ),
      );
      return;
    }

    if (hit.kind === "bond") {
      const data = this.graph.getMoleculeData();
      const bond = data.bonds[hit.index];
      const first = data.atoms[bond.i];
      const second = data.atoms[bond.j];
      const dx = second.x - first.x;
      const dy = second.y - first.y;
      const length = Math.hypot(dx, dy);
      if (length < 1e-6) return;
      const normalX = -dy / length;
      const normalY = dx / length;
      const apothem = length / (2 * Math.tan(Math.PI / this.ringSize));
      const midpointX = (first.x + second.x) / 2;
      const midpointY = (first.y + second.y) / 2;
      const candidates = [-1, 1].map((side) => {
        const cx = midpointX + normalX * apothem * side;
        const cy = midpointY + normalY * apothem * side;
        const firstAngle = Math.atan2(first.y - cy, first.x - cx);
        const secondAngle = Math.atan2(second.y - cy, second.x - cx);
        const delta = (secondAngle - firstAngle + Math.PI * 2) % (Math.PI * 2);
        const step = (Math.PI * 2) / this.ringSize;
        const clockwise =
          Math.abs(delta - step) > Math.abs(delta - (Math.PI * 2 - step));
        const template = buildRingTemplate(
          this.ringSize,
          cx,
          cy,
          length,
          this.ringKind,
          firstAngle,
          clockwise,
        );
        let clearance = 0;
        for (
          let vertexIndex = 2;
          vertexIndex < template.vertices.length;
          vertexIndex++
        ) {
          const vertex = template.vertices[vertexIndex];
          let nearest = Infinity;
          for (let atomIndex = 0; atomIndex < data.atoms.length; atomIndex++) {
            if (atomIndex === bond.i || atomIndex === bond.j) continue;
            const atom = data.atoms[atomIndex];
            nearest = Math.min(
              nearest,
              Math.hypot(vertex.x - atom.x, vertex.y - atom.y),
            );
          }
          clearance += Math.min(nearest, DEFAULT_BOND_LENGTH * 3);
        }
        return { cx, cy, firstAngle, clockwise, clearance };
      });
      const placement =
        candidates[1].clearance > candidates[0].clearance
          ? candidates[1]
          : candidates[0];
      this.executeCommand(
        new PlaceRingCommand(
          this.graph,
          this.ringSize,
          placement.cx,
          placement.cy,
          length,
          this.ringKind,
          placement.firstAngle,
          placement.clockwise,
          this.activeColor(),
        ),
      );
      return;
    }

    this.placeRingAt(doc.x, doc.y);
  }

  private handleKeyDown(e: KeyboardEvent): void {
    if (this.disabled) return;
    const key = e.key.toLowerCase();
    const hasModifier =
      isCtrlOrMeta({ ctrlKey: e.ctrlKey, metaKey: e.metaKey }) || e.altKey;
    const now = performance.now();
    if (
      !hasModifier &&
      this.elementPrefix &&
      now - this.elementPrefix.at <= 800
    ) {
      const pair = `${this.elementPrefix.key}${key}`;
      const symbol =
        pair === "cl"
          ? "Cl"
          : pair === "br"
            ? "Br"
            : pair === "si"
              ? "Si"
              : null;
      if (symbol) {
        e.preventDefault();
        this.elementPrefix = null;
        this.setElement(symbol);
        this.setTool("atom");
        return;
      }
    }
    if (!hasModifier && (key === "b" || key === "c" || key === "s")) {
      this.elementPrefix = { key, at: now };
    } else if (key !== "l" && key !== "r" && key !== "i") {
      this.elementPrefix = null;
    }

    const action = resolveKeymap(e);
    if (!action) return;
    e.preventDefault();
    switch (action.type) {
      case "undo":
        this.undo();
        break;
      case "redo":
        this.redo();
        break;
      case "delete": {
        if (this.selectedAtoms.size === 0 && this.selectedBonds.size === 0) {
          return;
        }
        this.executeCommand(
          new DeleteSelectionCommand(
            this.graph,
            [...this.selectedAtoms],
            [...this.selectedBonds],
          ),
        );
        this.clearSelection();
        this.emitState();
        break;
      }
      case "cancel":
        this.clearSelection();
        this.cancelTransientGesture();
        this.emitState();
        this.markDirty();
        break;
      case "bondOrder":
        this.setBondOrder(action.order);
        break;
      case "element":
        this.setElement(action.symbol);
        this.setTool("atom");
        break;
      case "panHold":
        this.spacePan = true;
        this.updateCursor();
        break;
    }
  }
}

function sameHit(first: BoardHit, second: BoardHit): boolean {
  if (first.kind !== second.kind) return false;
  if (first.kind === "none" || second.kind === "none") return true;
  return first.index === second.index;
}
