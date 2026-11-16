/**
 * Structure-formula proportions — the only place bond angles, label size,
 * stroke weight, and multi-bond spacing are defined.
 *
 * Ratios follow the ChemDraw ACS Document 1996 sheet, measured against one
 * bond length (14.4 pt on paper):
 *
 * - atom labels 10 pt → {@link DEPICTION_TOKENS.fontSizeRatio}
 * - line width 0.6 pt, bold width 2.0 pt
 * - double-bond spacing 18% of the bond
 * - hash spacing 2.5 pt
 *
 * Screen pixels are these ratios times the on-screen bond. There is no pixel
 * ceiling: a ceiling is what made a long bond grow while the label and the
 * double-bond gap stayed put. Floors exist only so a thumbnail does not
 * collapse to a sub-pixel hairline.
 *
 * The layout and both painters read this module. Do not copy the numbers
 * into the renderer, the exporter, or the layout.
 */

export const DEPICTION_TOKENS = {
  /** Acyclic zig-zag and the opening of a terminal cap, in degrees. */
  chainAngleDeg: 120,
  /** Direction of the first bond when an atom has nothing placed yet. */
  seedAngleDeg: -30,

  /**
   * A centre with one bond in and three leaf substituents (CF₃, CCl₃, t-Bu)
   * draws a cap: one substituent continues the bond, the other two sit
   * `chainAngleDeg` off the parent. Splitting the circle into four equal
   * 90° sectors draws a cross that towers over the rings.
   */
  terminalCap: true,

  /** em ÷ on-screen bond length. ACS 10 pt / 14.4 pt. */
  fontSizeRatio: 10 / 14.4,
  /** Raster floor. Does not bind at the board's minimum bond size. */
  fontMinPx: 5,
  fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif',
  labelWeight: 600,

  /** Stroke ÷ bond length. ACS line 0.6 pt, bold 2.0 pt. */
  lineWidthRatio: 0.6 / 14.4,
  hoverWidthRatio: 1.0 / 14.4,
  selectedWidthRatio: 2.0 / 14.4,
  lineMinPx: 0.6,

  /** Gap between the parallel lines of a double or triple bond ÷ bond length. */
  doubleBondSpacingRatio: 0.18,
  doubleBondSpacingMinPx: 0.75,
  /** Inner ring-double stops this fraction short of each end of the segment. */
  doubleBondInsetRatio: 0.12,

  /** Wide end of a wedge, and of the last hash, as a half-width ÷ bond length. */
  wedgeHalfRatio: 1.6 / 14.4,
  /** ACS hash spacing 2.5 pt → about six hashes along one bond. */
  hashCount: 6,
  /** Hash stroke ÷ the bond stroke it decorates. */
  hashWidthOfStroke: 0.8,

  /**
   * Gap between a bond end and the letter, ÷ em. Small on purpose: a fat
   * halo is what left Br and F floating off the end of the bond.
   */
  labelPadEm: 0.04,
  /**
   * Visible half-height of a symbol, ÷ em. A one-letter label is a disk of
   * this radius. A wider symbol (Br, Cl) is a box this tall, so the bond
   * meets the side of the word instead of a circle as wide as the word.
   */
  labelCapEm: 0.38,
  /** Hydrogenated labels (OH, NH₂) use a box. Vertical metrics ÷ em. */
  labelAscenderEm: 0.62,
  labelBodyEm: 1.24,

  /**
   * Dashed port ring ÷ bond length. Small enough that two ports on one
   * aromatic bond do not swallow the bond between them. A labelled port
   * (the ether O) grows to {@link portLabeledRadiusEm} so the ring sits
   * just outside the letter.
   */
  portPlainRadiusRatio: 0.2,
  portRadiusMinPx: 4,
  portLabeledRadiusEm: 0.52,
  /** Short tick from the ring to the descriptor, ÷ bond length. */
  portStubRatio: 0.16,
  portTextGapRatio: 0.12,
  portFontEm: 0.75,
  /** Dash on / off ÷ bond length. */
  portDashRatio: [0.1, 0.07] as const,

  selectionRingEm: 0.85,
  selectionRingRatio: 0.22,
  selectionRingMinPx: 5,
  hoverRingAlpha: 0.55,

  isolatedRadiusRatio: 0.08,
  isolatedColoredRadiusRatio: 0.1,
  isolatedRadiusMinPx: 2,

  gestureDashRatio: [0.16, 0.13] as const,
  marqueeDashRatio: [0.13, 0.1] as const,
  marqueeFillAlpha: 0.08,
  /** Optical baseline nudge so a middle-aligned glyph sits on the bond. */
  baselineNudgePx: 0.5,
} as const;

export interface DepictionInk {
  bondPx: number;
  fontPx: number;
  fontFamily: string;
  labelWeight: number;
  lineWidth: number;
  hoverWidth: number;
  selectedWidth: number;
  doubleSpacingPx: number;
  doubleInsetRatio: number;
  wedgeHalfPx: number;
  hashCount: number;
  hashWidthOfStroke: number;
  portPlainRadiusPx: number;
  portLabeledRadiusPx: number;
  portStubPx: number;
  portTextGapPx: number;
  portFontPx: number;
  portLineWidthPx: number;
  portDashPx: [number, number];
  selectionRingLabeledPx: number;
  selectionRingPlainPx: number;
  hoverRingAlpha: number;
  isolatedRadiusPx: number;
  isolatedColoredRadiusPx: number;
  gestureWidthPx: number;
  gestureDashPx: [number, number];
  marqueeWidthPx: number;
  marqueeDashPx: [number, number];
  marqueeFillAlpha: number;
  baselineNudgePx: number;
}

/** Pixels for one on-screen bond length. */
export function depictionInk(bondPx: number): DepictionInk {
  const t = DEPICTION_TOKENS;
  const bond = Math.max(1, bondPx);
  const fontPx = Math.max(t.fontMinPx, bond * t.fontSizeRatio);
  const lineWidth = Math.max(t.lineMinPx, bond * t.lineWidthRatio);
  const dash = (ratio: readonly [number, number]): [number, number] => [
    bond * ratio[0],
    bond * ratio[1],
  ];
  return {
    bondPx: bond,
    fontPx,
    fontFamily: t.fontFamily,
    labelWeight: t.labelWeight,
    lineWidth,
    hoverWidth: Math.max(lineWidth, bond * t.hoverWidthRatio),
    selectedWidth: Math.max(lineWidth, bond * t.selectedWidthRatio),
    doubleSpacingPx: Math.max(
      t.doubleBondSpacingMinPx,
      bond * t.doubleBondSpacingRatio,
    ),
    doubleInsetRatio: t.doubleBondInsetRatio,
    wedgeHalfPx: bond * t.wedgeHalfRatio,
    hashCount: t.hashCount,
    hashWidthOfStroke: t.hashWidthOfStroke,
    portPlainRadiusPx: Math.max(
      t.portRadiusMinPx,
      bond * t.portPlainRadiusRatio,
    ),
    portLabeledRadiusPx: Math.max(
      bond * t.portPlainRadiusRatio,
      fontPx * t.portLabeledRadiusEm,
    ),
    portStubPx: bond * t.portStubRatio,
    portTextGapPx: bond * t.portTextGapRatio,
    portFontPx: fontPx * t.portFontEm,
    portLineWidthPx: lineWidth,
    portDashPx: dash(t.portDashRatio),
    selectionRingLabeledPx: fontPx * t.selectionRingEm,
    selectionRingPlainPx: Math.max(
      t.selectionRingMinPx,
      bond * t.selectionRingRatio,
    ),
    hoverRingAlpha: t.hoverRingAlpha,
    isolatedRadiusPx: Math.max(
      t.isolatedRadiusMinPx,
      bond * t.isolatedRadiusRatio,
    ),
    isolatedColoredRadiusPx: Math.max(
      t.isolatedRadiusMinPx,
      bond * t.isolatedColoredRadiusRatio,
    ),
    gestureWidthPx: lineWidth,
    gestureDashPx: dash(t.gestureDashRatio),
    marqueeWidthPx: lineWidth,
    marqueeDashPx: dash(t.marqueeDashRatio),
    marqueeFillAlpha: t.marqueeFillAlpha,
    baselineNudgePx: t.baselineNudgePx,
  };
}

export interface LabelMask {
  /** Fallback inset when the bond direction is degenerate. */
  clearPx: number;
  /** Disk knockout radius. Zero when {@link rect} is the knockout. */
  radius: number;
  rect: { x: number; y: number; width: number; height: number } | null;
}

/**
 * Paper mask behind a label, and the shape a bond is clipped to.
 * One letter is a disk the size of the glyph. A wider symbol, or a label
 * with hydrogens, is a box: clipping "Br" to a circle the width of the word
 * leaves the bond short of the letters.
 */
export function labelMask(
  extent: { left: number; right: number },
  fontPx: number,
  hasHydrogens: boolean,
): LabelMask {
  const t = DEPICTION_TOKENS;
  const pad = fontPx * t.labelPadEm;
  const halfW = Math.max(Math.abs(extent.left), Math.abs(extent.right));
  const cap = fontPx * t.labelCapEm;
  if (hasHydrogens || halfW > cap) {
    const rect = hasHydrogens
      ? {
          x: extent.left - pad,
          y: -fontPx * t.labelAscenderEm,
          width: extent.right - extent.left + 2 * pad,
          height: fontPx * t.labelBodyEm,
        }
      : {
          x: -(halfW + pad),
          y: -(cap + pad),
          width: 2 * (halfW + pad),
          height: 2 * (cap + pad),
        };
    return {
      clearPx: Math.hypot(rect.width / 2, rect.height / 2),
      radius: 0,
      rect,
    };
  }
  const radius = Math.max(halfW, cap) + pad;
  return { clearPx: radius, radius, rect: null };
}

/**
 * How far a bond from `origin` toward `other` pulls back so it meets the
 * mask. A disk pulls back by its radius. A box pulls back to the side the
 * bond actually hits, not to the corner.
 */
export function labelInset(
  mask: LabelMask,
  origin: { x: number; y: number },
  other: { x: number; y: number },
): number {
  const dx = other.x - origin.x;
  const dy = other.y - origin.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6 || !mask.rect) return mask.rect ? mask.clearPx : mask.radius;
  const ux = dx / len;
  const uy = dy / len;
  const { x, y, width, height } = mask.rect;
  let t = Infinity;
  if (ux > 1e-8) t = Math.min(t, (x + width) / ux);
  else if (ux < -1e-8) t = Math.min(t, x / ux);
  if (uy > 1e-8) t = Math.min(t, (y + height) / uy);
  else if (uy < -1e-8) t = Math.min(t, y / uy);
  return Number.isFinite(t) && t > 0 ? t : mask.clearPx;
}

/** Document units a port marker extends past its atom. */
export function portReachDoc(): number {
  const t = DEPICTION_TOKENS;
  return (
    Math.max(t.portPlainRadiusRatio, t.portLabeledRadiusEm * t.fontSizeRatio) +
    t.portStubRatio +
    t.portTextGapRatio +
    t.portFontEm * t.fontSizeRatio * 0.9
  );
}

export function chainAngleRad(): number {
  return (DEPICTION_TOKENS.chainAngleDeg * Math.PI) / 180;
}

export function seedAngleRad(): number {
  return (DEPICTION_TOKENS.seedAngleDeg * Math.PI) / 180;
}

/**
 * Directions for three leaf substituents already attached by `parentAngle`.
 * Order is left of the continuation, straight on, right.
 */
export function terminalCapAngles(
  parentAngle: number,
): [number, number, number] {
  const turn = chainAngleRad();
  return [parentAngle + turn, parentAngle + Math.PI, parentAngle - turn];
}

export interface MarkPoint {
  x: number;
  y: number;
}

export type BondMark =
  | { kind: "line"; from: MarkPoint; to: MarkPoint; width: number }
  | { kind: "polygon"; points: [MarkPoint, MarkPoint, MarkPoint] };

/**
 * ChemDraw-style bond marks in screen pixels.
 * Ring doubles keep one line on the ring edge and a shorter line inside.
 * Acyclic doubles are two equal lines. Hashes and wedges scale with the bond.
 */
export function planBondMarks(
  from: MarkPoint,
  to: MarkPoint,
  order: number,
  stereo: "none" | "up" | "down",
  ink: DepictionInk,
  width: number,
  ringCentroid: MarkPoint | null,
): BondMark[] {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  let nx = -dy / len;
  let ny = dx / len;
  const midX = (from.x + to.x) / 2;
  const midY = (from.y + to.y) / 2;
  if (
    ringCentroid &&
    (ringCentroid.x - midX) * nx + (ringCentroid.y - midY) * ny < 0
  ) {
    nx = -nx;
    ny = -ny;
  }
  const gap = ink.doubleSpacingPx;

  if (stereo === "up" && order === 1) {
    const half = ink.wedgeHalfPx;
    return [
      {
        kind: "polygon",
        points: [
          from,
          { x: to.x + nx * half, y: to.y + ny * half },
          { x: to.x - nx * half, y: to.y - ny * half },
        ],
      },
    ];
  }

  if (stereo === "down" && order === 1) {
    const marks: BondMark[] = [];
    const hashWidth = Math.max(
      ink.lineWidth * 0.7,
      width * ink.hashWidthOfStroke,
    );
    for (let step = 1; step <= ink.hashCount; step++) {
      const t = step / ink.hashCount;
      const half = ink.wedgeHalfPx * t;
      const cx = from.x + dx * t;
      const cy = from.y + dy * t;
      marks.push({
        kind: "line",
        from: { x: cx + nx * half, y: cy + ny * half },
        to: { x: cx - nx * half, y: cy - ny * half },
        width: hashWidth,
      });
    }
    return marks;
  }

  const lines = Math.max(1, Math.min(3, order | 0));
  if (lines === 1) {
    return [{ kind: "line", from, to, width }];
  }

  if (lines === 2 && ringCentroid) {
    const inset = len * ink.doubleInsetRatio;
    const ux = dx / len;
    const uy = dy / len;
    return [
      { kind: "line", from, to, width },
      {
        kind: "line",
        from: {
          x: from.x + ux * inset + nx * gap,
          y: from.y + uy * inset + ny * gap,
        },
        to: {
          x: to.x - ux * inset + nx * gap,
          y: to.y - uy * inset + ny * gap,
        },
        width,
      },
    ];
  }

  if (lines === 2) {
    return [-gap / 2, gap / 2].map((offset) => ({
      kind: "line" as const,
      from: { x: from.x + nx * offset, y: from.y + ny * offset },
      to: { x: to.x + nx * offset, y: to.y + ny * offset },
      width,
    }));
  }

  return [-gap, 0, gap].map((offset) => ({
    kind: "line" as const,
    from: { x: from.x + nx * offset, y: from.y + ny * offset },
    to: { x: to.x + nx * offset, y: to.y + ny * offset },
    width,
  }));
}
