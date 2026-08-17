import { ViewportCoords } from "../board/coords";
import {
  SketchRenderer,
  type SketchRenderTheme,
} from "../board/sketch_renderer";
import type { MoleculeGraph } from "../molecule_graph";
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
    const labelClearPx = layout.fontPx * 0.72;
    const body: string[] = [
      `<rect width="${layout.width}" height="${layout.height}" fill="${escapeXml(layout.background)}"/>`,
    ];

    for (const bond of data.bonds) {
      const first = atomPoints[bond.i];
      const second = atomPoints[bond.j];
      if (!first || !second) continue;
      const segment = trimSegment(
        first,
        second,
        labeled[bond.i] ? labelClearPx : 0,
        labeled[bond.j] ? labelClearPx : 0,
      );
      if (!segment) continue;
      body.push(
        ...svgBond(
          segment.start,
          segment.end,
          bond.order,
          bond.stereo ?? "none",
          bond.color ?? this.theme.bondStroke,
          layout.fontPx,
        ),
      );
    }

    for (let index = 0; index < data.atoms.length; index++) {
      const atom = data.atoms[index];
      const point = atomPoints[index];
      if (!point) continue;
      if (!labeled[index]) {
        if (degrees[index] === 0) {
          const r = Math.max(1.5, Math.min(3.5, layout.fontPx * 0.28));
          body.push(
            `<circle cx="${num(point.x)}" cy="${num(point.y)}" r="${num(r)}" fill="${escapeXml(atom.color ?? this.theme.bondStroke)}"/>`,
          );
        }
        continue;
      }

      body.push(
        `<circle cx="${num(point.x)}" cy="${num(point.y)}" r="${num(layout.fontPx * 0.78)}" fill="${escapeXml(layout.labelBackdrop)}"/>`,
        `<text x="${num(point.x)}" y="${num(point.y + 0.5)}" fill="${escapeXml(atom.color ?? colorForElement(atom.element))}" font-family="Helvetica Neue,Helvetica,Arial,sans-serif" font-size="${num(layout.fontPx)}" font-weight="600" text-anchor="middle" dominant-baseline="central">${escapeXml(atom.element)}</text>`,
      );

      if (atom.charge !== undefined && atom.charge !== 0) {
        body.push(
          `<text x="${num(point.x + layout.fontPx * 0.45)}" y="${num(point.y - layout.fontPx * 0.15)}" fill="${escapeXml(atom.color ?? this.theme.labelFill)}" font-family="Helvetica Neue,Helvetica,Arial,sans-serif" font-size="${num(layout.fontPx * 0.72)}" font-weight="500" text-anchor="start">${escapeXml(chargeLabel(atom.charge))}</text>`,
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

  // Full-size exports keep ~12–22px labels. Menu thumbs (28–48px) must scale
  // down — a hard floor of 12px made heteroatoms cover the whole structure.
  const byScale = 0.38 * scale;
  const byCanvas = 0.2 * Math.min(width, height);
  const fontPx = Math.max(5, Math.min(22, byScale, byCanvas));

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
    fontPx,
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
    minX = Math.min(minX, atom.x);
    minY = Math.min(minY, atom.y);
    maxX = Math.max(maxX, atom.x);
    maxY = Math.max(maxY, atom.y);
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

function svgBond(
  start: Point,
  end: Point,
  order: number,
  stereo: "none" | "up" | "down",
  color: string,
  fontPx: number,
): string[] {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy) || 1;
  const normalX = -dy / length;
  const normalY = dx / length;
  const stroke = escapeXml(color);
  // Scale stroke + multi-bond gap with label size so 28–48px thumbs stay crisp.
  const strokeW = Math.max(0.9, Math.min(1.8, fontPx * 0.14));
  const gap = Math.max(1.0, Math.min(3.2, fontPx * 0.16));
  const line = (from: Point, to: Point, width = strokeW) =>
    `<line x1="${num(from.x)}" y1="${num(from.y)}" x2="${num(to.x)}" y2="${num(to.y)}" stroke="${stroke}" stroke-width="${num(width)}" stroke-linecap="round"/>`;

  if (stereo === "up" && order === 1) {
    const half = Math.max(2, gap * 2);
    return [
      `<polygon points="${num(start.x)},${num(start.y)} ${num(end.x + normalX * half)},${num(end.y + normalY * half)} ${num(end.x - normalX * half)},${num(end.y - normalY * half)}" fill="${stroke}"/>`,
    ];
  }
  if (stereo === "down" && order === 1) {
    const lines: string[] = [];
    for (let step = 1; step <= 9; step++) {
      const ratio = step / 9;
      const half = gap * 0.6 + gap * 2.2 * ratio;
      const center = {
        x: start.x + dx * ratio,
        y: start.y + dy * ratio,
      };
      lines.push(
        line(
          {
            x: center.x + normalX * half,
            y: center.y + normalY * half,
          },
          {
            x: center.x - normalX * half,
            y: center.y - normalY * half,
          },
          Math.max(0.7, strokeW * 0.75),
        ),
      );
    }
    return lines;
  }

  const lineCount = Math.max(1, Math.min(3, order | 0));
  const offsets =
    lineCount === 1
      ? [0]
      : lineCount === 2
        ? [-gap, gap]
        : [-gap * 2, 0, gap * 2];
  return offsets.map((offset) =>
    line(
      {
        x: start.x + normalX * offset,
        y: start.y + normalY * offset,
      },
      {
        x: end.x + normalX * offset,
        y: end.y + normalY * offset,
      },
    ),
  );
}

function chargeLabel(charge: number): string {
  if (charge > 0) return charge === 1 ? "+" : `${charge}+`;
  return charge === -1 ? "−" : `${Math.abs(charge)}−`;
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
