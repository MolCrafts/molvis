import {
  defineMolvisElementPicker,
  type MolvisElementPickerElement,
} from "@molcrafts/molvis-core/element-picker";
import { saveBlob } from "@molcrafts/molvis-core/save-file";
import {
  SketchBoard,
  type SketchBoardOptions,
  type SketchTool,
} from "../board/sketch_board";
import {
  DEFAULT_THEME,
  type SketchRenderTheme,
} from "../board/sketch_renderer";
import { fragmentPreviewSvg } from "../geometry/fragment_preview";
import {
  DEFAULT_FRAGMENT_ID,
  type FragmentTemplate,
  listFragmentCategories,
} from "../geometry/fragment_templates";
import {
  bondOrderIcon,
  chargeDeltaIcon,
  ICONS,
  parseSvgMarkup,
  ringSizeIcon,
  stereoModeIcon,
} from "./icons";
import { ensureComposerStyles } from "./styles";
import {
  readCanvasThemeFromHost,
  readCustomDefaultFromHost,
} from "./theme_bridge";

export interface SketchComposerOptions {
  /**
   * When `true` (default), mount icon toolbars around the canvas — same role as
   * stage's `gui` flag. When `false`, only the canvas fills the container
   * (host supplies its own chrome, or headless/embed use).
   */
  gui?: boolean;
  board?: SketchBoardOptions;
  theme?: Partial<SketchRenderTheme>;
  /** Host-specific file sink. Browser download is used when omitted. */
  onExportFile?: (blob: Blob, filename: string) => void | Promise<void>;
}

const TOOL_HELP: Record<SketchTool, string> = {
  select: "Click or drag content; drag empty paper to box-select.",
  erase: "Click an atom or bond to remove it.",
  bond: "Drag from an atom or empty paper; click a bond to change order.",
  atom: "Choose an element, then click paper or an existing atom.",
  ring: "Click paper, an atom, or a bond to place or fuse a ring.",
  chain:
    "Press and drag from an atom or empty paper; farther makes more bonds.",
  charge: "Choose + or −, then click an atom.",
  stereo: "Choose a wedge style, then click a single bond.",
  fragment:
    "Pick a fragment template, then click paper or an atom to place it.",
};

/** Quick picks in the atom-tool assoc rail (full table stays on the picker). */
const COMMON_ELEMENTS = [
  "C",
  "H",
  "N",
  "O",
  "S",
  "P",
  "F",
  "Cl",
  "Br",
  "I",
] as const;

const CHEM_TOOLS: Array<{
  id: SketchTool;
  label: string;
  icon: string;
  group: "edit" | "draw" | "decorate";
}> = [
  { id: "select", label: "Select", icon: "select", group: "edit" },
  { id: "erase", label: "Erase", icon: "erase", group: "edit" },
  { id: "bond", label: "Bond", icon: "bond", group: "draw" },
  { id: "atom", label: "Atom", icon: "atom", group: "draw" },
  { id: "ring", label: "Ring", icon: "ring", group: "draw" },
  {
    id: "fragment",
    label: "Fragment templates",
    icon: "fragment",
    group: "draw",
  },
  { id: "chain", label: "Chain", icon: "chain", group: "draw" },
  { id: "charge", label: "Charge", icon: "charge", group: "decorate" },
  { id: "stereo", label: "Stereo", icon: "stereo", group: "decorate" },
];

/**
 * Host shell for {@link SketchBoard}: optional icon-only tool rails (top common,
 * left chem, bottom context) controlled by the `gui` flag — analogous to
 * stage's `gui` / semi-headless path.
 *
 * Hosts that need product-only actions (e.g. pop-out, generate-3D) inject into
 * {@link extraSlot}.
 */
export class SketchComposer {
  readonly board: SketchBoard;
  /** Root element with class `molvis-sketch-composer`. */
  readonly root: HTMLElement;
  /**
   * Common-rail slot for host-only actions (React portals, generate-3D, …).
   * Empty when `gui: false`.
   */
  readonly extraSlot: HTMLElement;

  private readonly gui: boolean;
  private readonly onExportFile?: SketchComposerOptions["onExportFile"];
  /** Explicit theme from options — CSS host bridge must not clobber these. */
  private readonly explicitTheme: Partial<SketchRenderTheme>;
  private canvas: HTMLCanvasElement;
  private stage: HTMLElement;
  private commonBar: HTMLElement | null = null;
  private chemBar: HTMLElement | null = null;
  private assocBar: HTMLElement | null = null;
  private container: HTMLElement | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private unsubscribe: (() => void) | null = null;
  private toolButtons = new Map<SketchTool, HTMLButtonElement>();
  private orderButtons = new Map<1 | 2 | 3, HTMLButtonElement>();
  private elementPicker: MolvisElementPickerElement | null = null;
  private renderedAssocTool: SketchTool | null = null;
  private exportMenu: HTMLElement | null = null;
  private exportButton: HTMLButtonElement | null = null;
  private fragmentMenu: HTMLElement | null = null;
  private fragmentButton: HTMLButtonElement | null = null;
  private openSubmenuId: string | null = null;
  /** Wide-mode icon cluster in the common rail. */
  private commonInline: HTMLElement | null = null;
  private commonOverflowBtn: HTMLButtonElement | null = null;
  private commonOverflowMenu: HTMLElement | null = null;
  private commonRailObserver: ResizeObserver | null = null;
  private readonly onHostThemeChange = (): void => {
    this.syncCanvasThemeFromHost(false);
  };
  private readonly onDocPointerDown = (event: PointerEvent) => {
    const target = event.target as Node | null;
    if (
      this.exportMenu &&
      this.exportButton &&
      target &&
      !this.exportMenu.contains(target) &&
      !this.exportButton.contains(target)
    ) {
      this.setExportMenuOpen(false);
    }
    if (
      this.commonOverflowMenu &&
      this.commonOverflowBtn &&
      target &&
      !this.commonOverflowMenu.contains(target) &&
      !this.commonOverflowBtn.contains(target)
    ) {
      this.setCommonOverflowOpen(false);
    }
    if (
      this.fragmentMenu &&
      this.fragmentButton &&
      target &&
      !this.fragmentMenu.contains(target) &&
      !this.fragmentButton.contains(target)
    ) {
      this.setFragmentMenuOpen(false);
    }
  };
  private readonly onDocKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      this.setExportMenuOpen(false);
      this.setCommonOverflowOpen(false);
      this.setFragmentMenuOpen(false);
    }
  };

  constructor(options: SketchComposerOptions = {}) {
    this.gui = options.gui !== false;
    this.onExportFile = options.onExportFile;
    this.explicitTheme = options.theme ?? {};
    this.board = new SketchBoard(options.board);
    this.board.setTheme({
      ...DEFAULT_THEME,
      ...this.explicitTheme,
    });
    this.board.setRingTemplate(6, "benzene");
    this.board.setFragmentTemplate(DEFAULT_FRAGMENT_ID);
    this.board.setTool("bond");

    ensureComposerStyles();
    if (this.gui) {
      defineMolvisElementPicker();
    }

    this.root = document.createElement("section");
    this.root.className = "molvis-sketch-composer";
    this.root.setAttribute("aria-label", "Molecule sketch composer");
    this.root.dataset.gui = this.gui ? "true" : "false";

    this.extraSlot = document.createElement("div");
    this.extraSlot.className = "msk-extra-slot";

    this.stage = document.createElement("div");
    this.stage.className = "molvis-sketch-composer__stage";

    this.canvas = document.createElement("canvas");
    this.canvas.tabIndex = 0;
    this.canvas.setAttribute("aria-label", "2D molecule sketch");
    this.stage.appendChild(this.canvas);

    if (this.gui) {
      this.commonBar = document.createElement("div");
      this.commonBar.className = "molvis-sketch-composer__common";
      this.commonBar.setAttribute("role", "toolbar");
      this.commonBar.setAttribute("aria-label", "Edit");

      this.chemBar = document.createElement("div");
      this.chemBar.className = "molvis-sketch-composer__chem";
      this.chemBar.setAttribute("role", "toolbar");
      this.chemBar.setAttribute("aria-label", "Chem tools");
      this.chemBar.setAttribute("aria-orientation", "vertical");

      this.assocBar = document.createElement("div");
      this.assocBar.className = "molvis-sketch-composer__assoc";
      this.assocBar.setAttribute("role", "toolbar");
      this.assocBar.setAttribute("aria-label", "Tool options");

      this.root.append(this.commonBar, this.chemBar, this.stage, this.assocBar);
      this.buildCommonRail();
      this.buildChemRail();
    } else {
      this.root.appendChild(this.stage);
    }
  }

  /**
   * Mount into a host container (fills it).
   * Re-parenting to a new host (e.g. pop-out) keeps the board and chrome
   * instance — including portal targets — without a full teardown.
   */
  mount(container: HTMLElement): void {
    if (this.container === container && this.root.parentElement === container) {
      return;
    }

    if (this.container) {
      // Reparent only: board + listeners stay live.
      this.resizeObserver?.disconnect();
      this.resizeObserver = null;
      this.commonRailObserver?.disconnect();
      this.commonRailObserver = null;
      container.appendChild(this.root);
      this.container = container;
      this.observeStageSize();
      this.observeCommonRailWidth();
      // Host CSS tokens may differ after pop-out / reparent.
      this.syncCanvasThemeFromHost(false);
      return;
    }

    this.container = container;
    container.appendChild(this.root);
    this.board.mount(this.canvas);
    this.observeStageSize();
    this.observeCommonRailWidth();
    this.syncCanvasThemeFromHost(true);
    if (typeof window !== "undefined") {
      window.addEventListener("molvis:theme-change", this.onHostThemeChange);
    }

    if (this.gui) {
      this.unsubscribe = this.board.subscribe(() => this.syncUi());
      document.addEventListener("pointerdown", this.onDocPointerDown);
      document.addEventListener("keydown", this.onDocKeyDown);
      this.syncUi();
    }
  }

  unmount(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.commonRailObserver?.disconnect();
    this.commonRailObserver = null;
    if (typeof window !== "undefined") {
      window.removeEventListener("molvis:theme-change", this.onHostThemeChange);
    }
    document.removeEventListener("pointerdown", this.onDocPointerDown);
    document.removeEventListener("keydown", this.onDocKeyDown);
    this.board.unmount();
    this.root.remove();
    this.container = null;
  }

  /**
   * Resolve full canvas theme from `--msk-*` tokens after mount.
   * Explicit `options.theme` fields always win over the host bridge.
   *
   * @param syncCustomDefault - set once on first mount so the color picker
   *   tracks `--msk-custom-default`; later theme changes leave the user's swatch.
   */
  private syncCanvasThemeFromHost(syncCustomDefault = false): void {
    this.board.setTheme({
      ...readCanvasThemeFromHost(this.root, DEFAULT_THEME),
      ...this.explicitTheme,
    });
    if (syncCustomDefault) {
      this.board.setCustomColor(readCustomDefaultFromHost(this.root));
    }
  }

  private observeStageSize(): void {
    const resize = () => {
      const { width, height } = this.stage.getBoundingClientRect();
      if (width < 1 || height < 1) return;
      this.board.resize(width, height);
    };
    resize();
    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(resize);
      this.resizeObserver.observe(this.stage);
    }
  }

  setDisabled(disabled: boolean): void {
    this.board.setDisabled(disabled);
    this.root.dataset.disabled = disabled ? "true" : "false";
    this.syncUi();
  }

  setGui(gui: boolean): void {
    if (gui === this.gui) return;
    // Dynamic toggle would rebuild rails; keep mount-time only for v1.
    throw new Error(
      "SketchComposer gui is fixed at construction; remount with { gui } to change",
    );
  }

  getGui(): boolean {
    return this.gui;
  }

  private iconBtn(
    label: string,
    iconKey: string | null,
    onClick: () => void,
    opts?: { icon?: SVGSVGElement | HTMLElement; className?: string },
  ): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = opts?.className ? `msk-btn ${opts.className}` : "msk-btn";
    btn.title = label;
    btn.setAttribute("aria-label", label);
    if (opts?.icon) {
      btn.appendChild(opts.icon);
    } else if (iconKey && ICONS[iconKey]) {
      btn.appendChild(ICONS[iconKey]());
    }
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      onClick();
    });
    btn.addEventListener("pointerdown", (e) => e.stopPropagation());
    return btn;
  }

  private sep(parent: HTMLElement): void {
    const el = document.createElement("div");
    el.className = "msk-sep";
    el.setAttribute("role", "separator");
    parent.appendChild(el);
  }

  private buildCommonRail(): void {
    const bar = this.commonBar;
    if (!bar) return;

    // Wide: icon cluster. Narrow: hidden; actions live in the ⋯ menu.
    const inline = document.createElement("div");
    inline.className = "msk-common-inline";
    this.commonInline = inline;

    inline.appendChild(
      this.iconBtn("Undo", "undo", () => {
        this.board.undo();
      }),
    );
    inline.appendChild(
      this.iconBtn("Redo", "redo", () => {
        this.board.redo();
      }),
    );
    this.sep(inline);
    inline.appendChild(
      this.iconBtn("Clear", "clear", () => {
        this.board.clear();
      }),
    );
    inline.appendChild(
      this.iconBtn("Fit", "fit", () => {
        this.board.fitToView();
      }),
    );
    this.sep(inline);

    const exportControl = document.createElement("div");
    exportControl.className = "msk-export";
    this.exportMenu = document.createElement("div");
    this.exportMenu.className = "msk-menu";
    this.exportMenu.hidden = true;
    this.exportMenu.setAttribute("role", "menu");
    this.exportMenu.setAttribute("aria-label", "Export format");

    this.exportButton = this.iconBtn("Export", "export", () => {
      this.setCommonOverflowOpen(false);
      this.setExportMenuOpen(!!this.exportMenu?.hidden);
    });
    this.exportButton.setAttribute("aria-haspopup", "menu");
    this.exportButton.setAttribute("aria-expanded", "false");

    this.exportMenu.appendChild(
      this.menuOption(
        "SVG",
        () => void this.exportSketch("svg"),
        "Export as SVG",
      ),
    );
    this.exportMenu.appendChild(
      this.menuOption(
        "PNG",
        () => void this.exportSketch("png"),
        "Export as PNG",
      ),
    );
    exportControl.append(this.exportButton, this.exportMenu);
    inline.appendChild(exportControl);

    // Narrow: single ⋯ menu with the same actions (icon + label).
    const overflow = document.createElement("div");
    overflow.className = "msk-common-overflow";

    this.commonOverflowMenu = document.createElement("div");
    this.commonOverflowMenu.className = "msk-menu msk-common-overflow-menu";
    this.commonOverflowMenu.hidden = true;
    this.commonOverflowMenu.setAttribute("role", "menu");
    this.commonOverflowMenu.setAttribute("aria-label", "Edit actions");

    const addOverflowItem = (
      label: string,
      iconKey: string,
      action: () => void,
      dataKey: string,
    ) => {
      const item = this.menuOptionIcon(label, iconKey, () => {
        this.setCommonOverflowOpen(false);
        action();
      });
      item.dataset.commonAction = dataKey;
      this.commonOverflowMenu?.appendChild(item);
    };
    addOverflowItem("Undo", "undo", () => this.board.undo(), "undo");
    addOverflowItem("Redo", "redo", () => this.board.redo(), "redo");
    addOverflowItem("Clear", "clear", () => this.board.clear(), "clear");
    addOverflowItem("Fit", "fit", () => this.board.fitToView(), "fit");
    addOverflowItem(
      "Export SVG",
      "export",
      () => void this.exportSketch("svg"),
      "export-svg",
    );
    addOverflowItem(
      "Export PNG",
      "export",
      () => void this.exportSketch("png"),
      "export-png",
    );

    this.commonOverflowBtn = this.iconBtn("Edit actions", "more", () => {
      this.setExportMenuOpen(false);
      this.setCommonOverflowOpen(!!this.commonOverflowMenu?.hidden);
    });
    this.commonOverflowBtn.setAttribute("aria-haspopup", "menu");
    this.commonOverflowBtn.setAttribute("aria-expanded", "false");

    overflow.append(this.commonOverflowBtn, this.commonOverflowMenu);

    bar.append(inline, overflow, this.extraSlot);
  }

  private setCommonOverflowOpen(open: boolean): void {
    if (!this.commonOverflowMenu || !this.commonOverflowBtn) return;
    this.commonOverflowMenu.hidden = !open;
    this.commonOverflowBtn.setAttribute(
      "aria-expanded",
      open ? "true" : "false",
    );
    if (open) {
      this.syncCommonOverflowDisabled();
      // Pin menu under the ⋯ button in viewport coords (survives overflow:hidden).
      const r = this.commonOverflowBtn.getBoundingClientRect();
      const menu = this.commonOverflowMenu;
      menu.style.position = "fixed";
      menu.style.top = `${r.bottom + 3}px`;
      menu.style.left = `${Math.max(8, r.left)}px`;
      menu.style.right = "auto";
      menu.style.zIndex = "50";
    }
  }

  private syncCommonOverflowDisabled(): void {
    if (!this.commonOverflowMenu) return;
    const state = this.board.getState();
    for (const item of this.commonOverflowMenu.querySelectorAll<HTMLButtonElement>(
      "[data-common-action]",
    )) {
      const key = item.dataset.commonAction ?? "";
      if (key === "undo") item.disabled = state.disabled || !state.canUndo;
      else if (key === "redo") item.disabled = state.disabled || !state.canRedo;
      else if (
        key === "clear" ||
        key === "fit" ||
        key === "export-svg" ||
        key === "export-png"
      ) {
        item.disabled = state.disabled || state.atomCount === 0;
      } else {
        item.disabled = state.disabled;
      }
    }
  }

  /**
   * When the common rail is too narrow for the icon cluster, switch to a
   * single ⋯ dropdown. Host {@link extraSlot} always stays visible.
   */
  private updateCommonCompact(): void {
    const bar = this.commonBar;
    const inline = this.commonInline;
    if (!bar || !inline) return;

    // Measure icon cluster while expanded so scrollWidth is honest.
    bar.dataset.compact = "false";
    const need = inline.scrollWidth;
    const extra = this.extraSlot.offsetWidth;
    // Room for the ⋯ button when we switch to compact.
    const overflowBtn = this.commonOverflowBtn?.offsetWidth ?? 28;
    const avail = bar.clientWidth - extra - 8;
    const compact = need > avail && avail > 0;
    bar.dataset.compact = compact ? "true" : "false";
    if (!compact) {
      this.setCommonOverflowOpen(false);
    } else {
      // Ensure ⋯ + extra still fit; extra is already excluded from avail.
      void overflowBtn;
    }
  }

  private observeCommonRailWidth(): void {
    if (!this.commonBar || typeof ResizeObserver === "undefined") return;
    this.commonRailObserver?.disconnect();
    this.commonRailObserver = new ResizeObserver(() => {
      this.updateCommonCompact();
    });
    this.commonRailObserver.observe(this.commonBar);
    // Host may inject into extraSlot after mount — remeasure next frame.
    requestAnimationFrame(() => this.updateCommonCompact());
  }

  private menuOption(
    label: string,
    onSelect: () => void | Promise<void>,
    ariaLabel?: string,
  ): HTMLButtonElement {
    const option = document.createElement("button");
    option.type = "button";
    option.className = "msk-menu-option";
    option.setAttribute("role", "menuitem");
    option.setAttribute("aria-label", ariaLabel ?? label);
    option.textContent = label;
    option.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.setExportMenuOpen(false);
      void onSelect();
    });
    return option;
  }

  /** Menu row with toolbar icon + label (overflow / compact chrome). */
  private menuOptionIcon(
    label: string,
    iconKey: string,
    onSelect: () => void | Promise<void>,
  ): HTMLButtonElement {
    const option = document.createElement("button");
    option.type = "button";
    option.className = "msk-menu-option msk-menu-option--icon";
    option.setAttribute("role", "menuitem");
    option.setAttribute("aria-label", label);
    option.title = label;
    if (ICONS[iconKey]) {
      const icon = ICONS[iconKey]();
      icon.classList.add("msk-menu-option-icon");
      option.appendChild(icon);
    }
    const text = document.createElement("span");
    text.className = "msk-menu-option-label";
    text.textContent = label;
    option.appendChild(text);
    option.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.setExportMenuOpen(false);
      void onSelect();
    });
    option.addEventListener("pointerdown", (e) => e.stopPropagation());
    return option;
  }

  private setExportMenuOpen(open: boolean): void {
    if (!this.exportMenu || !this.exportButton) return;
    this.exportMenu.hidden = !open;
    this.exportButton.setAttribute("aria-expanded", open ? "true" : "false");
  }

  private setFragmentMenuOpen(open: boolean): void {
    if (!this.fragmentMenu || !this.fragmentButton) return;
    this.fragmentMenu.hidden = !open;
    this.fragmentButton.setAttribute("aria-expanded", open ? "true" : "false");
    if (!open) {
      this.openSubmenuId = null;
      for (const fly of this.fragmentMenu.querySelectorAll<HTMLElement>(
        ".msk-menu--flyout",
      )) {
        fly.hidden = true;
      }
      for (const row of this.fragmentMenu.querySelectorAll<HTMLElement>(
        ".msk-category-row",
      )) {
        row.setAttribute("aria-expanded", "false");
      }
    }
  }

  private buildChemRail(): void {
    const bar = this.chemBar;
    if (!bar) return;
    this.toolButtons.clear();

    for (let i = 0; i < CHEM_TOOLS.length; i++) {
      const t = CHEM_TOOLS[i];
      if (i > 0 && CHEM_TOOLS[i - 1].group !== t.group) {
        this.sep(bar);
      }

      if (t.id === "fragment") {
        this.buildFragmentControl(bar);
        continue;
      }

      const btn = this.iconBtn(t.label, t.icon, () => {
        this.board.setTool(t.id);
        if (t.id === "ring") this.board.setRingTemplate(6, "benzene");
        if (t.id === "charge") this.board.setChargeDelta(1);
        if (t.id === "stereo") this.board.setStereoMode("up");
      });
      btn.title = `${t.label}: ${TOOL_HELP[t.id]}`;
      bar.appendChild(btn);
      this.toolButtons.set(t.id, btn);
    }
  }

  private buildFragmentControl(bar: HTMLElement): void {
    const control = document.createElement("div");
    control.className = "msk-fragment-control";

    this.fragmentButton = this.iconBtn("Fragment templates", "fragment", () => {
      this.setFragmentMenuOpen(!!this.fragmentMenu?.hidden);
    });
    this.fragmentButton.title = `Fragments: ${TOOL_HELP.fragment}`;
    this.fragmentButton.setAttribute("aria-haspopup", "menu");
    this.fragmentButton.setAttribute("aria-expanded", "false");
    this.toolButtons.set("fragment", this.fragmentButton);

    this.fragmentMenu = document.createElement("div");
    this.fragmentMenu.className = "msk-menu";
    this.fragmentMenu.hidden = true;
    this.fragmentMenu.setAttribute("role", "menu");
    this.fragmentMenu.setAttribute("aria-label", "Fragment templates");

    for (const category of listFragmentCategories()) {
      const rowWrap = document.createElement("div");
      rowWrap.className = "msk-submenu";

      const row = document.createElement("button");
      row.type = "button";
      row.className = "msk-category-row";
      row.setAttribute("aria-label", category.label);
      row.setAttribute("aria-haspopup", "menu");
      row.setAttribute("aria-expanded", "false");
      row.title = category.label;

      // Structure-only category cue — name lives in aria-label / title, not chrome text.
      const lead = category.templates[0];
      if (lead) {
        const preview = document.createElement("span");
        preview.className = "msk-category-preview";
        preview.setAttribute("aria-hidden", "true");
        preview.appendChild(
          parseSvgMarkup(
            fragmentPreviewSvg(lead, { width: 32, height: 32, padding: 2 }),
          ),
        );
        row.appendChild(preview);
      }
      const chevron = ICONS.chevron();
      chevron.classList.add("msk-chevron");
      chevron.setAttribute("aria-hidden", "true");
      row.appendChild(chevron);

      const flyout = document.createElement("div");
      flyout.className = "msk-menu msk-menu--flyout";
      flyout.hidden = true;
      flyout.setAttribute("role", "menu");
      flyout.setAttribute("aria-label", category.label);

      for (const template of category.templates) {
        flyout.appendChild(this.fragmentPreviewButton(template));
      }

      row.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const open = this.openSubmenuId !== category.id;
        this.openSubmenuId = open ? category.id : null;
        const menu = this.fragmentMenu;
        if (!menu) return;
        for (const other of menu.querySelectorAll<HTMLElement>(
          ".msk-menu--flyout",
        )) {
          other.hidden = true;
        }
        for (const otherRow of menu.querySelectorAll<HTMLElement>(
          ".msk-category-row",
        )) {
          otherRow.setAttribute("aria-expanded", "false");
        }
        flyout.hidden = !open;
        row.setAttribute("aria-expanded", open ? "true" : "false");
        if (open) {
          // Fixed-position flyout next to the row (survives chem rail scroll).
          const r = row.getBoundingClientRect();
          const gap = 4;
          const maxW = Math.min(window.innerWidth * 0.9, 320);
          let left = r.right + gap;
          if (left + maxW > window.innerWidth - 8) {
            left = Math.max(8, r.left - maxW - gap);
          }
          const maxH = Math.min(window.innerHeight * 0.7, 420);
          let top = r.top;
          if (top + maxH > window.innerHeight - 8) {
            top = Math.max(8, window.innerHeight - maxH - 8);
          }
          flyout.style.top = `${top}px`;
          flyout.style.left = `${left}px`;
        }
      });
      row.addEventListener("pointerdown", (e) => e.stopPropagation());

      rowWrap.append(row, flyout);
      this.fragmentMenu.appendChild(rowWrap);
    }

    control.append(this.fragmentButton, this.fragmentMenu);
    bar.appendChild(control);
  }

  private fragmentPreviewButton(template: FragmentTemplate): HTMLButtonElement {
    const svg = parseSvgMarkup(
      fragmentPreviewSvg(template, { width: 48, height: 48, padding: 4 }),
    );
    const btn = this.iconBtn(
      template.label,
      null,
      () => {
        this.board.setFragmentTemplate(template.id);
        this.board.setTool("fragment");
        this.setFragmentMenuOpen(false);
      },
      { icon: svg, className: "msk-btn--preview" },
    );
    btn.setAttribute("role", "menuitem");
    // Structure diagram only — label is aria/title, not visible text.
    btn.title = template.label;
    return btn;
  }

  private rebuildAssoc(): void {
    const bar = this.assocBar;
    if (!bar) return;
    bar.replaceChildren();
    this.elementPicker = null;
    this.orderButtons.clear();

    const tool = this.board.getTool();
    const state = this.board.getState();
    const disabled = state.disabled;

    if (tool === "atom") {
      const current = this.board.getElement();
      for (const symbol of COMMON_ELEMENTS) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "msk-btn msk-element-chip";
        btn.textContent = symbol;
        btn.title = symbol;
        btn.setAttribute("aria-label", `Element ${symbol}`);
        btn.dataset.element = symbol;
        btn.disabled = disabled;
        const selected = current === symbol;
        btn.classList.toggle("active", selected);
        btn.setAttribute("aria-pressed", selected ? "true" : "false");
        btn.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          this.board.setElement(symbol);
          this.board.setTool("atom");
          this.syncUi();
        });
        btn.addEventListener("pointerdown", (e) => e.stopPropagation());
        bar.appendChild(btn);
      }
      this.sep(bar);
      // Full periodic table for less-common elements.
      const picker = document.createElement(
        "molvis-element-picker",
      ) as MolvisElementPickerElement;
      picker.setAttribute("compact", "");
      picker.value = current;
      picker.disabled = disabled;
      picker.title = "More elements";
      picker.setAttribute("aria-label", "More elements");
      picker.addEventListener("input", () => {
        this.board.setElement(picker.value);
        this.board.setTool("atom");
        this.syncUi();
      });
      bar.appendChild(picker);
      this.elementPicker = picker;
    }

    if (tool === "bond") {
      for (const o of [1, 2, 3] as const) {
        const btn = this.iconBtn(
          `Bond order ${o}`,
          null,
          () => {
            this.board.setBondOrder(o);
          },
          { icon: bondOrderIcon(o) },
        );
        btn.disabled = disabled;
        bar.appendChild(btn);
        this.orderButtons.set(o, btn);
      }
    }

    if (tool === "ring") {
      for (const size of [3, 4, 5, 6, 7, 8] as const) {
        const btn = this.iconBtn(
          `${size}-membered ring`,
          null,
          () => {
            this.board.setRingTemplate(size, "aliphatic");
            this.board.setTool("ring");
          },
          { icon: ringSizeIcon(size) },
        );
        btn.disabled = disabled;
        const selected =
          state.ringKind === "aliphatic" && state.ringSize === size;
        btn.classList.toggle("active", selected);
        btn.setAttribute("aria-pressed", selected ? "true" : "false");
        bar.appendChild(btn);
      }
      const bz = this.iconBtn(
        "Benzene",
        null,
        () => {
          this.board.setRingTemplate(6, "benzene");
          this.board.setTool("ring");
        },
        { icon: ringSizeIcon(6, true) },
      );
      bz.disabled = disabled;
      const benzeneSelected =
        state.ringKind === "benzene" && state.ringSize === 6;
      bz.classList.toggle("active", benzeneSelected);
      bz.setAttribute("aria-pressed", benzeneSelected ? "true" : "false");
      bar.appendChild(bz);
    }

    if (tool === "fragment") {
      // Show selected fragment structure in context rail (structure only).
      const template = this.board.getFragmentTemplate();
      const preview = this.iconBtn(
        template.label,
        null,
        () => {
          this.setFragmentMenuOpen(true);
        },
        {
          icon: parseSvgMarkup(
            fragmentPreviewSvg(template, {
              width: 48,
              height: 48,
              padding: 4,
            }),
          ),
          className: "msk-btn--preview",
        },
      );
      preview.disabled = disabled;
      preview.classList.add("active");
      bar.appendChild(preview);
    }

    if (tool === "charge") {
      for (const delta of [-1, 1] as const) {
        const btn = this.iconBtn(
          delta < 0 ? "Decrease formal charge" : "Increase formal charge",
          null,
          () => {
            this.board.setChargeDelta(delta);
            this.board.setTool("charge");
          },
          { icon: chargeDeltaIcon(delta) },
        );
        btn.disabled = disabled;
        const selected = state.chargeDelta === delta;
        btn.classList.toggle("active", selected);
        btn.setAttribute("aria-pressed", selected ? "true" : "false");
        bar.appendChild(btn);
      }
    }

    if (tool === "stereo") {
      for (const mode of ["up", "down", "none"] as const) {
        const btn = this.iconBtn(
          mode === "up"
            ? "Solid wedge"
            : mode === "down"
              ? "Hashed wedge"
              : "Clear stereochemistry",
          null,
          () => {
            this.board.setStereoMode(mode);
            this.board.setTool("stereo");
          },
          { icon: stereoModeIcon(mode) },
        );
        btn.disabled = disabled;
        const selected = state.stereoMode === mode;
        btn.classList.toggle("active", selected);
        btn.setAttribute("aria-pressed", selected ? "true" : "false");
        bar.appendChild(btn);
      }
    }

    const colorControls = document.createElement("div");
    colorControls.className = "msk-assoc-color-controls";
    if (bar.childElementCount > 0) this.sep(colorControls);

    const colorToggle = this.iconBtn("Color override", "color", () => {
      const next = !state.colorOverrideEnabled;
      this.board.setColorOverrideEnabled(next);
      if (state.selectedAtomCount + state.selectedBondCount > 0) {
        this.board.applyColorToSelection(next ? state.customColor : null);
      }
      this.renderedAssocTool = null;
      this.syncUi();
    });
    colorToggle.title = state.colorOverrideEnabled
      ? "Color override on: use default colors"
      : "Color override off: override new and selected content";
    colorToggle.disabled = disabled;
    colorToggle.classList.toggle("active", state.colorOverrideEnabled);
    colorToggle.setAttribute(
      "aria-pressed",
      state.colorOverrideEnabled ? "true" : "false",
    );
    colorControls.appendChild(colorToggle);

    const colorInput = document.createElement("input");
    colorInput.className = "msk-assoc-color";
    colorInput.type = "color";
    colorInput.title = "Choose override color";
    colorInput.setAttribute("aria-label", "Choose override color");
    colorInput.value = state.customColor;
    colorInput.disabled = disabled || !state.colorOverrideEnabled;
    colorInput.addEventListener("input", () => {
      this.board.setCustomColor(colorInput.value);
      if (
        state.colorOverrideEnabled &&
        state.selectedAtomCount + state.selectedBondCount > 0
      ) {
        this.board.applyColorToSelection(colorInput.value);
      }
    });
    colorControls.appendChild(colorInput);
    bar.appendChild(colorControls);
  }

  private syncUi(): void {
    if (!this.gui) return;
    const state = this.board.getState();
    const current = state.tool;

    for (const [id, btn] of this.toolButtons) {
      btn.classList.toggle("active", id === current);
      btn.setAttribute("aria-pressed", id === current ? "true" : "false");
      btn.disabled = state.disabled;
    }

    if (this.renderedAssocTool !== current) {
      this.rebuildAssoc();
      this.renderedAssocTool = current;
    } else if (
      current === "ring" ||
      current === "fragment" ||
      current === "charge" ||
      current === "stereo"
    ) {
      // Refresh selection highlights without full rebuild when cheap.
      this.rebuildAssoc();
    }

    if (this.elementPicker) {
      this.elementPicker.value = this.board.getElement();
      this.elementPicker.disabled = state.disabled;
    }
    // Atom-tool quick chips (keyboard element shortcuts update these).
    if (this.assocBar && this.board.getTool() === "atom") {
      const el = this.board.getElement();
      for (const btn of this.assocBar.querySelectorAll<HTMLButtonElement>(
        ".msk-element-chip",
      )) {
        const selected = btn.dataset.element === el;
        btn.classList.toggle("active", selected);
        btn.setAttribute("aria-pressed", selected ? "true" : "false");
        btn.disabled = state.disabled;
      }
    }
    const order = this.board.getBondOrder();
    for (const [o, btn] of this.orderButtons) {
      btn.classList.toggle("active", o === order);
      btn.disabled = state.disabled;
    }

    // Common rail: undo/redo/clear/fit/export (inline icons + overflow menu)
    if (this.commonInline) {
      const buttons = this.commonInline.querySelectorAll<HTMLButtonElement>(
        ":scope > .msk-btn, :scope > .msk-export > .msk-btn",
      );
      for (const btn of buttons) {
        const label = btn.getAttribute("aria-label") ?? "";
        if (label === "Undo") btn.disabled = state.disabled || !state.canUndo;
        else if (label === "Redo")
          btn.disabled = state.disabled || !state.canRedo;
        else if (label === "Clear" || label === "Fit" || label === "Export") {
          btn.disabled = state.disabled || state.atomCount === 0;
        }
      }
    }
    if (this.commonOverflowBtn) {
      this.commonOverflowBtn.disabled = state.disabled;
    }
    if (this.commonOverflowMenu && !this.commonOverflowMenu.hidden) {
      this.syncCommonOverflowDisabled();
    }
  }

  private async exportSketch(format: "svg" | "png"): Promise<void> {
    if (this.board.getMoleculeData().atoms.length === 0) return;
    const blob =
      format === "svg"
        ? new Blob([this.board.toSvg()], {
            type: "image/svg+xml;charset=utf-8",
          })
        : await this.board.toPng();
    const filename = `molvis-sketch.${format}`;
    if (this.onExportFile) {
      await this.onExportFile(blob, filename);
    } else {
      await saveBlob(blob, filename);
    }
  }
}
