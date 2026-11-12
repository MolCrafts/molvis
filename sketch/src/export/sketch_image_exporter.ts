import { ViewportCoords } from "../board/coords";
import {
  SketchRenderer,
  type SketchRenderTheme,
} from "../board/sketch_renderer";
import { bondRingCentroid } from "../geometry/bond_ring";
import type { MoleculeGraph } from "../molecule_graph";
import { AtomLabel } from "../style/atom_label";
import {
  type BondMark,
  type DepictionInk,
  depictionInk,
  labelInset,
  labelMask,
  planBondMarks,
  portReachDoc,
} from "../style/depiction-tokens";
import { colorForElement, isLabeledElement } from "../style/element_colors";
import type { MoleculeData } from "../types";

const DEFAULT_EXPORT_WIDTH = 1200;
const DEFAULT_EXPORT_HEIGHT = 800;
const DEFAULT_EXPORT_PADDING = 48;
const DEFAULT_PIXEL_RATIO = 2;
const MAX_EXPORT_DIMENSION = 8192;
const MAX_PIXEL_RATIO = 4;
const MAX_EXPORT_SCALE = 72;

export interface SketchExportOptions {
  /** Export surface width in CSS pixels. Default 1200. */
  width?: number;
  /** Export surface height in CSS pixels. Default 800. */
  height?: number;
  /** Minimum whitespace around the fitted molecule in CSS pixels. Default 48. */
  padding?: number;
  /** PNG backing-store multiplier. Default 2; ignored by SVG export. */
  pixelRatio?: number;
  /** Paper color. Defaults to the board render theme background. */
  background?: string;
}

interface ExportLayout {
  width: number;
  height: number;
  pixelRatio: number;
  background: string;
  /** Opaque fill behind element labels (may differ from paper when transparent). */
  labelBackdrop: string;
  centerX: number;
  centerY: number;
  scale: number;
  fontPx: number;
  ink: DepictionInk;
}

interface Point {
  x: number;
  y: number;
}

/**
 * Stateless image exporter owned by a {@link SketchBoard}.
 *
 * The exporter always fits a clean molecule snapshot: editor selection,
 * hover, marquee, and gesture previews never leak into exported artwork.
 */
export class SketchImageExporter {
  constructor(
    private readonly graph: MoleculeGraph,
    private readonly theme: SketchRenderTheme,
    private readonly omitCarbonLabel: boolean,
  ) {}

  toSvg(options: SketchExportOptions = {}): string {
    const data = this.graph.getMoleculeData();
    const layout = resolveLayout(data, this.theme, options);
    const atomPoints = data.atoms.map((atom) =>
      toScreen(atom.x, atom.y, layout),
    );
    const labeled = data.atoms.map((atom) =>
      isLabeledElement(atom.element, {
        omitCarbonLabel: this.omitCarbonLabel,
        charge: atom.charge,
        forceLabel: false,
      }),
    );
    const degrees = atomDegrees(data);
    const { ink } = layout;
    const adjacency = Array.from(
      { length: data.atoms.length },
      (): Array<{ atom: number; bond: number }> => [],
    );
    data.bonds.forEach((bond, bondIndex) => {
      adjacency[bond.i]?.push({ atom: bond.j, bond: bondIndex });
      adjacency[bond.j]?.push({ atom: bond.i, bond: bondIndex });
    });
    const labels = data.atoms.map((atom, index) => {
      const point = atomPoints[index] ?? { x: 0, y: 0 };
      return new AtomLabel(
        atom,
        point,
        (adjacency[index] ?? []).map((edge) => atomPoints[edge.atom] ?? point),
      );
    });
    const masks = labels.map((label, index) =>
      labeled[index]
        ? labelMask(label.extent(ink.fontPx), ink.fontPx, label.hasHydrogens)
        : null,
    );
    const body: string[] = [
      `<rect width="${layout.width}" height="${layout.height}" fill="${escapeXml(layout.background)}"/>`,
    ];

    data.bonds.forEach((bond, bondIndex) => {
      const first = atomPoints[bond.i];
      const second = atomPoints[bond.j];
      if (!first || !second) return;
      const maskI = masks[bond.i];
      const maskJ = masks[bond.j];
      const segment = trimSegment(
        first,
        second,
        maskI ? labelInset(maskI, first, second) : 0,
        maskJ ? labelInset(maskJ, second, first) : 0,
      );
      if (!segment) return;
      body.push(
        ...svgMarks(
          planBondMarks(
            segment.start,
            segment.end,
            bond.order,
            bond.stereo ?? "none",
            ink,
            ink.lineWidth,
            bond.order === 2
              ? bondRingCentroid(data, atomPoints, adjacency, bondIndex)
              : null,
          ),
          bond.color ?? this.theme.bondStroke,
        ),
      );
    });

    for (let index = 0; index < data.atoms.length; index++) {
      const atom = data.atoms[index];
      const point = atomPoints[index];
      const label = labels[index];
      const mask = masks[index];
      if (!atom || !point || !label) continue;
      if (!labeled[index]) {
        if (degrees[index] === 0) {
          const r = atom.color
            ? ink.isolatedColoredRadiusPx
            : ink.isolatedRadiusPx;
          body.push(
            `<circle cx="${num(point.x)}" cy="${num(point.y)}" r="${num(r)}" fill="${escapeXml(atom.color ?? this.theme.bondStroke)}"/>`,
          );
        }
      } else if (mask) {
        if (mask.rect) {
          body.push(
            `<rect x="${num(point.x + mask.rect.x)}" y="${num(point.y + mask.rect.y)}" width="${num(mask.rect.width)}" height="${num(mask.rect.height)}" fill="${escapeXml(layout.labelBackdrop)}"/>`,
          );
        } else {
          body.push(
            `<circle cx="${num(point.x)}" cy="${num(point.y)}" r="${num(mask.radius)}" fill="${escapeXml(layout.labelBackdrop)}"/>`,
          );
        }
        for (const run of label.runs(ink.fontPx)) {
          const fill =
            run.role === "charge"
              ? (atom.color ?? this.theme.labelFill)
              : (atom.color ?? colorForElement(atom.element));
          body.push(
            `<text x="${num(point.x + run.dx)}" y="${num(point.y + run.dy + ink.baselineNudgePx)}" fill="${escapeXml(fill)}" font-family="${escapeXml(ink.fontFamily)}" font-size="${num(run.size)}" font-weight="${run.weight}" text-anchor="${run.anchor}" dominant-baseline="central">${escapeXml(run.text)}</text>`,
          );
        }
      }

      if (atom.port !== undefined) {
        body.push(
          ...svgPort(
            point,
            label.freeDirection,
            atom.port,
            labeled[index] ? ink.portLabeledRadiusPx : ink.portPlainRadiusPx,
            ink,
            this.theme.portStroke,
          ),
        );
      }
    }

    return [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${layout.width}" height="${layout.height}" viewBox="0 0 ${layout.width} ${layout.height}" role="img" aria-label="Molecule structure">`,
      ...body,
      "</svg>",
    ].join("\n");
  }

  async toPng(options: SketchExportOptions = {}): Promise<Blob> {
    const data = this.graph.getMoleculeData();
    const layout = resolveLayout(data, this.theme, options);
    const canvas = document.createElement("canvas");
    const viewport = new ViewportCoords();
    viewport.resize(layout.width, layout.height, layout.pixelRatio);
    viewport.setPan(layout.centerX, layout.centerY);
    viewport.setScale(layout.scale);
    const backingStore = viewport.getBackingStoreSize();
    canvas.width = backingStore.width;
    canvas.height = backingStore.height;

    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Canvas 2D context is unavailable");
    }
    const renderer = new SketchRenderer();
    renderer.setTheme({
      ...this.theme,
      background: layout.background,
    });
    renderer.paint(context, this.graph, viewport, {
      selectedAtoms: new Set(),
      selectedBonds: new Set(),
      omitCarbonLabel: this.omitCarbonLabel,
      atomRadiusDoc: 0,
    });

    return new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error("PNG encoding failed"));
        }
      }, "image/png");
    });
  }
}

function resolveLayout(
  data: MoleculeData,
  theme: SketchRenderTheme,
  options: SketchExportOptions,
): ExportLayout {
  const width = integerOption(
    "width",
    options.width,
    DEFAULT_EXPORT_WIDTH,
    MAX_EXPORT_DIMENSION,
  );
  const height = integerOption(
    "height",
    options.height,
    DEFAULT_EXPORT_HEIGHT,
    MAX_EXPORT_DIMENSION,
  );
  const padding = finiteOption(
    "padding",
    options.padding,
    DEFAULT_EXPORT_PADDING,
    0,
    Math.min(width, height) / 2,
  );
  const pixelRatio = finiteOption(
    "pixelRatio",
    options.pixelRatio,
    DEFAULT_PIXEL_RATIO,
    Number.EPSILON,
    MAX_PIXEL_RATIO,
  );
  const bounds = moleculeBounds(data);
  // Pad span so single-atom / short fragments still leave ink room for labels.
  const spanX = Math.max(bounds.maxX - bounds.minX + 1, 1);
  const spanY = Math.max(bounds.maxY - bounds.minY + 1, 1);
  const usableWidth = Math.max(1, width - padding * 2);
  const usableHeight = Math.max(1, height - padding * 2);
  const scale = Math.min(
    usableWidth / spanX,
    usableHeight / spanY,
    MAX_EXPORT_SCALE,
  );

  // Same ratios as the canvas. A pixel ceiling here is what made labels and
  // double-bond gaps stay small while the fitted bond grew.
  const ink = depictionInk(scale);

  const paper = options.background ?? theme.background;
  // Transparent paper (menu previews) still needs an opaque knockout behind
  // element letters so bonds don't bleed through N/O/S.
  const labelBackdrop = isTransparentPaint(paper)
    ? "var(--msk-stage-bg, #ffffff)"
    : paper;

  return {
    width,
    height,
    pixelRatio,
    background: paper,
    labelBackdrop,
    centerX: (bounds.minX + bounds.maxX) / 2,
    centerY: (bounds.minY + bounds.maxY) / 2,
    scale,
    fontPx: ink.fontPx,
    ink,
  };
}

function isTransparentPaint(paint: string): boolean {
  const value = paint.trim().toLowerCase();
  return (
    value === "transparent" ||
    value === "none" ||
    value === "rgba(0,0,0,0)" ||
    value === "rgba(0, 0, 0, 0)"
  );
}

function moleculeBounds(data: MoleculeData): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} {
  if (data.atoms.length === 0) {
    return { minX: -0.5, minY: -0.5, maxX: 0.5, maxY: 0.5 };
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const atom of data.atoms) {
    // A port marker reaches about one bond past its atom; keep it on paper.
    const reach = atom.port !== undefined ? portReachDoc() : 0;
    minX = Math.min(minX, atom.x - reach);
    minY = Math.min(minY, atom.y - reach);
    maxX = Math.max(maxX, atom.x + reach);
    maxY = Math.max(maxY, atom.y + reach);
  }
  return { minX, minY, maxX, maxY };
}

function atomDegrees(data: MoleculeData): Uint32Array {
  const degrees = new Uint32Array(data.atoms.length);
  for (const bond of data.bonds) {
    if (bond.i < degrees.length) degrees[bond.i] += 1;
    if (bond.j < degrees.length) degrees[bond.j] += 1;
  }
  return degrees;
}

function toScreen(x: number, y: number, layout: ExportLayout): Point {
  return {
    x: (x - layout.centerX) * layout.scale + layout.width / 2,
    y: layout.height / 2 - (y - layout.centerY) * layout.scale,
  };
}

function trimSegment(
  start: Point,
  end: Point,
  startInset: number,
  endInset: number,
): { start: Point; end: Point } | null {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (length < 1e-6) return null;
  if (startInset + endInset >= length * 0.92) {
    const midX = (start.x + end.x) / 2;
    const midY = (start.y + end.y) / 2;
    const unitX = dx / length;
    const unitY = dy / length;
    return {
      start: { x: midX - unitX * 2, y: midY - unitY * 2 },
      end: { x: midX + unitX * 2, y: midY + unitY * 2 },
    };
  }
  const unitX = dx / length;
  const unitY = dy / length;
  return {
    start: {
      x: start.x + unitX * startInset,
      y: start.y + unitY * startInset,
    },
    end: {
      x: end.x - unitX * endInset,
      y: end.y - unitY * endInset,
    },
  };
}

function svgMarks(marks: readonly BondMark[], color: string): string[] {
  const stroke = escapeXml(color);
  return marks.map((mark) => {
    if (mark.kind === "polygon") {
      const points = mark.points
        .map((point) => `${num(point.x)},${num(point.y)}`)
        .join(" ");
      return `<polygon points="${points}" fill="${stroke}"/>`;
    }
    return `<line x1="${num(mark.from.x)}" y1="${num(mark.from.y)}" x2="${num(mark.to.x)}" y2="${num(mark.to.y)}" stroke="${stroke}" stroke-width="${num(mark.width)}" stroke-linecap="round"/>`;
  });
}

/** Port marker in SVG — same geometry as `SketchRenderer.paintPort`. */
function svgPort(
  p: Point,
  direction: Point,
  descriptor: string,
  ringRadius: number,
  ink: DepictionInk,
  color: string,
): string[] {
  const stroke = escapeXml(color);
  const stubEnd = ringRadius + ink.portStubPx;
  const textAt = stubEnd + ink.portTextGapPx;
  const dash = `${num(ink.portDashPx[0])} ${num(ink.portDashPx[1])}`;
  return [
    `<g class="msk-port" data-port="${escapeXml(descriptor)}">`,
    `<circle cx="${num(p.x)}" cy="${num(p.y)}" r="${num(ringRadius)}" fill="none" stroke="${stroke}" stroke-width="${num(ink.portLineWidthPx)}" stroke-dasharray="${dash}"/>`,
    `<line x1="${num(p.x + direction.x * ringRadius)}" y1="${num(p.y + direction.y * ringRadius)}" x2="${num(p.x + direction.x * stubEnd)}" y2="${num(p.y + direction.y * stubEnd)}" stroke="${stroke}" stroke-width="${num(ink.portLineWidthPx)}" stroke-linecap="round"/>`,
    `<text x="${num(p.x + direction.x * textAt)}" y="${num(p.y + direction.y * textAt)}" fill="${stroke}" font-family="${escapeXml(ink.fontFamily)}" font-size="${num(ink.portFontPx)}" font-weight="${ink.labelWeight}" text-anchor="middle" dominant-baseline="central">${escapeXml(descriptor)}</text>`,
    "</g>",
  ];
}

function integerOption(
  name: string,
  value: number | undefined,
  fallback: number,
  maximum: number,
): number {
  const resolved = value ?? fallback;
  if (
    !Number.isFinite(resolved) ||
    resolved <= 0 ||
    resolved > maximum ||
    !Number.isInteger(resolved)
  ) {
    throw new Error(`${name} must be an integer between 1 and ${maximum}`);
  }
  return resolved;
}

function finiteOption(
  name: string,
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const resolved = value ?? fallback;
  if (!Number.isFinite(resolved) || resolved < minimum || resolved > maximum) {
    throw new Error(`${name} must be in [${minimum}, ${maximum}]`);
  }
  return resolved;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function num(value: number): string {
  return Number(value.toFixed(3)).toString();
}
