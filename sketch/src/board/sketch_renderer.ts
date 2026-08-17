import type { MoleculeGraph } from "../molecule_graph";
import { colorForElement, isLabeledElement } from "../style/element_colors";
import { defaultCanvasTheme } from "../style/tokens";
import type { MoleculeData } from "../types";
import type { ViewportCoords } from "./coords";

export interface SketchRenderTheme {
  /** Paper background — token `--msk-stage-bg`. */
  background: string;
  /** Bond / carbon skeleton stroke — token `--msk-ink`. */
  bondStroke: string;
  /** Selection / hover / marquee — token `--msk-active-ink`. */
  selectionStroke: string;
  /** Fallback label fill — token `--msk-ink`. */
  labelFill: string;
}

/**
 * Token fallbacks for headless / pre-mount. Hosts override via `--msk-*`
 * (see {@link readCanvasThemeFromHost}).
 */
export const DEFAULT_THEME: SketchRenderTheme = defaultCanvasTheme();
export interface SketchRenderState {
  selectedAtoms: ReadonlySet<number>;
  selectedBonds: ReadonlySet<number>;
  hoveredAtom?: number;
  hoveredBond?: number;
  omitCarbonLabel: boolean;
  /** Hit-test / label clearance radius in document units. */
  atomRadiusDoc: number;
  /** Non-destructive translation shown while a selection drag is active. */
  movePreview?: {
    atomIndices: ReadonlySet<number>;
    dx: number;
    dy: number;
  };
  /** Rubber-band rectangle in document coordinates. */
  marquee?: {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
  };
  /** Prospective bond/chain polyline in document coordinates. */
  gesturePreview?: {
    points: ReadonlyArray<{ x: number; y: number }>;
  };
}

/**
 * Canvas 2D structure-formula renderer.
 *
 * - Skeleton: black bonds; carbon vertices have no filled balls
 * - Heteroatoms / H: element symbols only (optional element-colored text)
 * - Bonds stop short of labeled atoms so lines do not cross letters
 * - Selection: open ring / bold bond — never CPK spheres
 */
export class SketchRenderer {
  private theme: SketchRenderTheme = { ...DEFAULT_THEME };

  setTheme(theme: Partial<SketchRenderTheme>): void {
    this.theme = { ...this.theme, ...theme };
  }

  getTheme(): SketchRenderTheme {
    return { ...this.theme };
  }

  paint(
    ctx: CanvasRenderingContext2D,
    graph: MoleculeGraph,
    viewport: ViewportCoords,
    state: SketchRenderState,
  ): void {
    const { width, height } = viewport.getCssSize();
    const dpr = viewport.getDpr();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = this.theme.background;
    ctx.fillRect(0, 0, width, height);

    const data = graph.getMoleculeData();
    const scale = viewport.getScale();
    // Label size ~ proportional to bond length on screen
    const fontPx = Math.max(12, Math.min(22, 0.38 * scale));
    // How far bonds pull back from a labeled atom (screen px)
    const labelClearPx = fontPx * 0.72;

    const labeled = data.atoms.map((atom) =>
      isLabeledElement(atom.element, {
        omitCarbonLabel: state.omitCarbonLabel,
        charge: atom.charge,
        forceLabel: false,
      }),
    );
    const degrees = new Uint32Array(data.atoms.length);
    for (const bond of data.bonds) {
      if (bond.i < degrees.length) degrees[bond.i] += 1;
      if (bond.j < degrees.length) degrees[bond.j] += 1;
    }
    const atomPoints = data.atoms.map((atom, atomIndex) => {
      const moving = state.movePreview?.atomIndices.has(atomIndex) ?? false;
      return viewport.docToScreen(
        atom.x + (moving ? (state.movePreview?.dx ?? 0) : 0),
        atom.y + (moving ? (state.movePreview?.dy ?? 0) : 0),
      );
    });
    const adjacency = Array.from(
      { length: data.atoms.length },
      (): Array<{ atom: number; bond: number }> => [],
    );
    for (let bondIndex = 0; bondIndex < data.bonds.length; bondIndex++) {
      const bond = data.bonds[bondIndex];
      adjacency[bond.i]?.push({ atom: bond.j, bond: bondIndex });
      adjacency[bond.j]?.push({ atom: bond.i, bond: bondIndex });
    }

    // --- Bonds (under labels) ---
    for (let bi = 0; bi < data.bonds.length; bi++) {
      const bond = data.bonds[bi];
      const a = data.atoms[bond.i];
      const b = data.atoms[bond.j];
      if (!a || !b) continue;
      const p1 = atomPoints[bond.i];
      const p2 = atomPoints[bond.j];
      if (!p1 || !p2) continue;
      const trimmed = trimBondSegment(
        p1.x,
        p1.y,
        p2.x,
        p2.y,
        labeled[bond.i] ? labelClearPx : 0,
        labeled[bond.j] ? labelClearPx : 0,
      );
      if (!trimmed) continue;
      const selected = state.selectedBonds.has(bi);
      const hovered = state.hoveredBond === bi;
      drawBond(
        ctx,
        trimmed.x1,
        trimmed.y1,
        trimmed.x2,
        trimmed.y2,
        bond.order,
        bond.stereo ?? "none",
        {
          stroke:
            selected || hovered
              ? this.theme.selectionStroke
              : (bond.color ?? this.theme.bondStroke),
          // Slightly thinner than before — less "marker pen"
          width: selected ? 2.0 : hovered ? 1.75 : 1.35,
        },
        bond.order === 2
          ? findRingCentroid(data, atomPoints, adjacency, bi)
          : null,
      );
    }

    if (state.gesturePreview && state.gesturePreview.points.length >= 2) {
      const preview = state.gesturePreview.points.map((point) =>
        viewport.docToScreen(point.x, point.y),
      );
      ctx.beginPath();
      ctx.moveTo(preview[0].x, preview[0].y);
      for (let index = 1; index < preview.length; index++) {
        ctx.lineTo(preview[index].x, preview[index].y);
      }
      ctx.strokeStyle = this.theme.selectionStroke;
      ctx.lineWidth = 1.5;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.setLineDash([5, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // --- Atom labels & selection rings ---
    for (let i = 0; i < data.atoms.length; i++) {
      const atom = data.atoms[i];
      const p = atomPoints[i];
      const selected = state.selectedAtoms.has(i);
      const hovered = state.hoveredAtom === i;
      const showLabel = labeled[i];

      if (selected || hovered) {
        // Open selection ring — structure-formula style, not a ball
        const r = showLabel ? fontPx * 0.85 : Math.max(5, 0.12 * scale);
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.strokeStyle = this.theme.selectionStroke;
        ctx.lineWidth = selected ? 1.75 : 1.25;
        ctx.globalAlpha = selected ? 1 : 0.55;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      if (!showLabel) {
        // Only an isolated implicit carbon gets an endpoint, using its custom
        // color and larger size when present.
        if (degrees[i] === 0) {
          ctx.beginPath();
          ctx.arc(p.x, p.y, atom.color ? 3 : 2.5, 0, Math.PI * 2);
          ctx.fillStyle = atom.color ?? this.theme.bondStroke;
          ctx.fill();
        }
        continue;
      }

      // White disk behind letter so bonds look "cut" cleanly
      const halo = fontPx * 0.78;
      ctx.beginPath();
      ctx.arc(p.x, p.y, halo, 0, Math.PI * 2);
      ctx.fillStyle = this.theme.background;
      ctx.fill();

      ctx.fillStyle = atom.color ?? colorForElement(atom.element);
      ctx.font = `600 ${fontPx}px "Helvetica Neue", Helvetica, Arial, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(atom.element, p.x, p.y + 0.5);

      if (atom.charge !== undefined && atom.charge !== 0) {
        const sign =
          atom.charge > 0
            ? atom.charge === 1
              ? "+"
              : `${atom.charge}+`
            : atom.charge === -1
              ? "−"
              : `${Math.abs(atom.charge)}−`;
        ctx.font = `500 ${fontPx * 0.72}px "Helvetica Neue", Helvetica, Arial, sans-serif`;
        ctx.textAlign = "left";
        ctx.textBaseline = "bottom";
        ctx.fillStyle = atom.color ?? this.theme.labelFill;
        ctx.fillText(sign, p.x + fontPx * 0.45, p.y - fontPx * 0.15);
      }
    }

    if (state.marquee) {
      const start = viewport.docToScreen(state.marquee.x0, state.marquee.y0);
      const end = viewport.docToScreen(state.marquee.x1, state.marquee.y1);
      const left = Math.min(start.x, end.x);
      const right = Math.max(start.x, end.x);
      const top = Math.min(start.y, end.y);
      const bottom = Math.max(start.y, end.y);
      ctx.beginPath();
      ctx.rect(left, top, right - left, bottom - top);
      ctx.fillStyle = this.theme.selectionStroke;
      ctx.globalAlpha = 0.08;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = this.theme.selectionStroke;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }
}

/** Shorten a segment from each end by inset pixels; null if degenerate. */
function trimBondSegment(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  inset1: number,
  inset2: number,
): { x1: number; y1: number; x2: number; y2: number } | null {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return null;
  if (inset1 + inset2 >= len * 0.92) {
    // Still draw a short mid segment so topology is visible
    const mx = (x1 + x2) / 2;
    const my = (y1 + y2) / 2;
    const ux = dx / len;
    const uy = dy / len;
    return {
      x1: mx - ux * 2,
      y1: my - uy * 2,
      x2: mx + ux * 2,
      y2: my + uy * 2,
    };
  }
  const ux = dx / len;
  const uy = dy / len;
  return {
    x1: x1 + ux * inset1,
    y1: y1 + uy * inset1,
    x2: x2 - ux * inset2,
    y2: y2 - uy * inset2,
  };
}

/**
 * ChemDraw / Ketcher style bonds:
 * - single: one stroke
 * - double: main on axis + second line offset toward centroid (inner for rings)
 * - triple: axis + both sides
 */
function drawBond(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  order: number,
  stereo: "none" | "up" | "down",
  style: { stroke: string; width: number },
  ringCentroid: { x: number; y: number } | null,
): void {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  let nx = -dy / len;
  let ny = dx / len;
  // Prefer normal pointing toward the local ring center.
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  if (
    ringCentroid &&
    (ringCentroid.x - mx) * nx + (ringCentroid.y - my) * ny < 0
  ) {
    nx = -nx;
    ny = -ny;
  }
  // ChemDraw double-bond gap ~3px at typical zoom
  const spacing = 3.0;

  ctx.strokeStyle = style.stroke;
  ctx.fillStyle = style.stroke;
  ctx.lineWidth = style.width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  if (stereo === "up" && order === 1) {
    const half = Math.max(3.5, style.width * 2.6);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2 + nx * half, y2 + ny * half);
    ctx.lineTo(x2 - nx * half, y2 - ny * half);
    ctx.closePath();
    ctx.fill();
    return;
  }

  if (stereo === "down" && order === 1) {
    const steps = 9;
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      const w = 1.0 + 4.2 * t;
      const cx = x1 + dx * t;
      const cy = y1 + dy * t;
      ctx.beginPath();
      ctx.moveTo(cx + nx * w, cy + ny * w);
      ctx.lineTo(cx - nx * w, cy - ny * w);
      ctx.lineWidth = Math.max(1.0, style.width * 0.8);
      ctx.stroke();
    }
    ctx.lineWidth = style.width;
    return;
  }

  const lines = Math.max(1, Math.min(3, order | 0));
  if (lines === 1) {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    return;
  }

  if (lines === 2) {
    if (ringCentroid) {
      // Ring double: main edge + a shorter stroke toward the local ring center.
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      const inset = Math.min(4, len * 0.12);
      const ux = dx / len;
      const uy = dy / len;
      ctx.beginPath();
      ctx.moveTo(
        x1 + ux * inset + nx * spacing,
        y1 + uy * inset + ny * spacing,
      );
      ctx.lineTo(
        x2 - ux * inset + nx * spacing,
        y2 - uy * inset + ny * spacing,
      );
      ctx.stroke();
    } else {
      // Acyclic double: two symmetric, equal strokes.
      for (const offset of [-spacing / 2, spacing / 2]) {
        ctx.beginPath();
        ctx.moveTo(x1 + nx * offset, y1 + ny * offset);
        ctx.lineTo(x2 + nx * offset, y2 + ny * offset);
        ctx.stroke();
      }
    }
    return;
  }

  // Triple
  for (const o of [-spacing, 0, spacing]) {
    ctx.beginPath();
    ctx.moveTo(x1 + nx * o, y1 + ny * o);
    ctx.lineTo(x2 + nx * o, y2 + ny * o);
    ctx.stroke();
  }
}

function findRingCentroid(
  data: MoleculeData,
  atomPoints: ReadonlyArray<{ x: number; y: number }>,
  adjacency: ReadonlyArray<ReadonlyArray<{ atom: number; bond: number }>>,
  excludedBond: number,
): { x: number; y: number } | null {
  const bond = data.bonds[excludedBond];
  const parent = new Int32Array(data.atoms.length);
  parent.fill(-1);
  parent[bond.i] = bond.i;
  const queue = [bond.i];
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const atom = queue[cursor];
    if (atom === bond.j) break;
    for (const edge of adjacency[atom] ?? []) {
      if (edge.bond === excludedBond || parent[edge.atom] !== -1) continue;
      parent[edge.atom] = atom;
      queue.push(edge.atom);
    }
  }
  if (parent[bond.j] === -1) return null;

  const cycleAtoms = [bond.j];
  let atom = bond.j;
  while (atom !== bond.i) {
    atom = parent[atom];
    cycleAtoms.push(atom);
  }
  let x = 0;
  let y = 0;
  for (const atomIndex of cycleAtoms) {
    x += atomPoints[atomIndex].x;
    y += atomPoints[atomIndex].y;
  }
  return { x: x / cycleAtoms.length, y: y / cycleAtoms.length };
}
