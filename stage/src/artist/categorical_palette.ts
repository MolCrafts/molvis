/**
 * Colours for an open-ended set of categories (particle types, source ids).
 *
 * The count is fixed for any one scene but unknown in advance, so what we
 * need is not "a palette of N" but a *sequence* whose every prefix is itself
 * well separated: the third type to appear takes the third entry, the
 * twentieth takes the twentieth, and neither reshuffles the other.
 *
 * Sequential farthest-point sampling (Glasbey et al. 2007, "Colour displays
 * for categorical images") has exactly that property by construction: each
 * step picks the candidate whose *minimum* distance to everything already
 * chosen is largest, so truncating the sequence never leaves a close pair
 * behind. Distances are OkLab, where equal steps are equally visible — hue
 * alone is not, which is why this works in three dimensions and not one.
 *
 */
import type { LinearRGB } from "./palette";

/** A colour in OkLab — perceptually uniform, so Euclidean distance means something. */
type OkLab = readonly [number, number, number];

export interface CategoricalSequenceOptions {
  /**
   * The canvas colour. Seeded as "already taken", which is what keeps every
   * generated colour off the background — including a white one, without a
   * hard lightness rule that would have to know which way the canvas leans.
   */
  background: LinearRGB;
  /**
   * Colours already spoken for, kept at a distance for the same reason —
   * e.g. the fixed entries of a named palette this sequence extends.
   */
  reserved?: readonly LinearRGB[];
}

/**
 * Chroma ceiling in OkLab. Uncapped, farthest-point sampling walks straight
 * into the corners of sRGB and returns neon; this keeps it to colours that
 * can sit next to each other on screen for an hour.
 */
const MAX_CHROMA = 0.22;

/** Sanity band. The background seed does the real work; this only excludes near-black and near-white. */
const MIN_LIGHTNESS = 0.25;
const MAX_LIGHTNESS = 0.95;

/** Samples per sRGB axis. 16³ = 4096 candidates, of which ~a third survive the filters. */
const GRID_STEPS = 16;

function linearToOklab(rgb: LinearRGB): OkLab {
  const [r, g, b] = rgb;
  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;
  const l_ = Math.cbrt(l);
  const m_ = Math.cbrt(m);
  const s_ = Math.cbrt(s);
  return [
    0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_,
    1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_,
    0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_,
  ];
}

function distance(a: OkLab, b: OkLab): number {
  const dl = a[0] - b[0];
  const da = a[1] - b[1];
  const db = a[2] - b[2];
  return Math.sqrt(dl * dl + da * da + db * db);
}

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

interface Candidates {
  readonly rgb: readonly LinearRGB[];
  readonly lab: readonly OkLab[];
}

let candidateCache: Candidates | null = null;

/** The quantised sRGB cube, filtered and cached — it does not depend on the background. */
function candidates(): Candidates {
  if (candidateCache) return candidateCache;
  const rgb: LinearRGB[] = [];
  const lab: OkLab[] = [];
  for (let i = 0; i < GRID_STEPS; i++) {
    for (let j = 0; j < GRID_STEPS; j++) {
      for (let k = 0; k < GRID_STEPS; k++) {
        const linear: LinearRGB = [
          srgbToLinear(i / (GRID_STEPS - 1)),
          srgbToLinear(j / (GRID_STEPS - 1)),
          srgbToLinear(k / (GRID_STEPS - 1)),
        ];
        const okl = linearToOklab(linear);
        if (okl[0] < MIN_LIGHTNESS || okl[0] > MAX_LIGHTNESS) continue;
        if (Math.hypot(okl[1], okl[2]) > MAX_CHROMA) continue;
        rgb.push(linear);
        lab.push(okl);
      }
    }
  }
  candidateCache = { rgb, lab };
  return candidateCache;
}

/**
 * A sequence in progress. Keeping `minDistance` alive is what makes asking
 * for 5 colours and then 20 cost the same as asking for 20 once — the greedy
 * step only ever appends, so a longer request resumes where the last left off.
 */
interface SequenceState {
  readonly key: string;
  readonly colors: LinearRGB[];
  readonly minDistance: number[];
}

let cached: SequenceState | null = null;

function seedKey(
  background: LinearRGB,
  reserved: readonly LinearRGB[],
): string {
  const parts = [background, ...reserved].map((c) =>
    c.map((v) => v.toFixed(4)).join(","),
  );
  return parts.join("|");
}

function extend(state: SequenceState, count: number): LinearRGB[] {
  const { rgb, lab } = candidates();
  while (state.colors.length < count) {
    let best = 0;
    for (let i = 1; i < lab.length; i++) {
      if (state.minDistance[i] > state.minDistance[best]) best = i;
    }
    state.colors.push(rgb[best]);
    const picked = lab[best];
    for (let i = 0; i < lab.length; i++) {
      const d = distance(lab[i], picked);
      if (d < state.minDistance[i]) state.minDistance[i] = d;
    }
  }
  return state.colors.slice(0, count);
}

/**
 * `count` colours, maximally separated from each other, from the background,
 * and from any reserved colours.
 *
 * Deterministic: the same arguments always give the same sequence, and a
 * longer `count` extends a shorter one rather than replacing it — a category
 * appearing does not restyle the categories already on screen.
 */
export function categoricalSequence(
  count: number,
  options: CategoricalSequenceOptions,
): LinearRGB[] {
  if (count <= 0) return [];
  const reserved = options.reserved ?? [];
  const key = seedKey(options.background, reserved);

  if (cached?.key === key) return extend(cached, count);

  const { lab } = candidates();
  const seeds = [options.background, ...reserved].map(linearToOklab);
  const minDistance = lab.map((c) =>
    seeds.reduce(
      (acc, seed) => Math.min(acc, distance(c, seed)),
      Number.POSITIVE_INFINITY,
    ),
  );
  cached = { key, colors: [], minDistance };
  return extend(cached, count);
}

/** Drop the memoised sequence. Exposed for tests; callers key on the background instead. */
export function resetCategoricalSequenceCache(): void {
  cached = null;
  candidateCache = null;
}
