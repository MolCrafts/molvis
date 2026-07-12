import type { Frame } from "@molcrafts/molrs";
import {
  type AnalysisDefinition,
  type AnalysisRequirement,
  isFrameColumnRequirement,
  requirementColumns,
} from "./registry";

/**
 * Where an analysis input comes from.
 *
 * - `frameColumn` — the frame either carries the columns or it does not.
 * - `panelInput` — the panel derives it from the scene (topology, selection).
 * - `upstreamResult` — it is the output of another analysis, so the analysis
 *   cannot be driven from a frame alone.
 */
export type RequirementSource = "frameColumn" | "panelInput" | "upstreamResult";

const PANEL_INPUTS: ReadonlySet<AnalysisRequirement> = new Set([
  "atomPairs",
  "atomTriples",
  "atomQuads",
  "atomGroups",
  "donors",
  "acceptors",
  "labels",
  "voidMask",
  "referenceAtoms",
  "targetAtoms",
  "template",
]);

/**
 * Panel inputs this build actually derives from the scene. A `panelInput` that
 * is not listed here is reported unsatisfied, so a picker disables the analysis
 * instead of offering a control that would throw on run.
 */
const PANEL_SUPPLIED: ReadonlySet<AnalysisRequirement> = new Set([
  "atomPairs",
  "atomTriples",
  "atomQuads",
  "labels",
  "voidMask",
]);

/**
 * What the panel needs from the scene to supply a `panelInput`.
 *
 * Identifiers a user could type — column names, block names — are wrapped in
 * backticks so a renderer can set them in a code face. See {@link stripCode}
 * for plain-text hosts such as a `title` tooltip.
 */
const PANEL_INPUT_SOURCES: Readonly<
  Partial<Record<AnalysisRequirement, string>>
> = {
  atomPairs: "a `bonds` block",
  atomTriples: "a `bonds` block (angles are derived from it)",
  atomQuads: "a `bonds` block (dihedrals are derived from it)",
  labels: "an `element`, `mol_id` or `type` column",
  voidMask: "an atom selection marking the probe atoms",
};

/** Drop the backtick markers, for hosts that cannot render a code face. */
export function stripCode(text: string): string {
  return text.replace(/`/g, "");
}

export function requirementSource(
  requirement: AnalysisRequirement,
): RequirementSource {
  if (isFrameColumnRequirement(requirement)) return "frameColumn";
  return PANEL_INPUTS.has(requirement) ? "panelInput" : "upstreamResult";
}

/**
 * Column names present on a frame's `atoms` block.
 *
 * Cached per frame: a picker probes every catalog entry on each render, and
 * during playback the frame changes every tick — without the cache that is a
 * hundred `getBlock` handles per frame.
 */
const COLUMN_CACHE = new WeakMap<Frame, ReadonlySet<string>>();

export function atomColumns(frame: Frame): ReadonlySet<string> {
  const cached = COLUMN_CACHE.get(frame);
  if (cached) return cached;
  const atoms = frame.getBlock("atoms");
  const columns: ReadonlySet<string> = atoms
    ? new Set(atoms.keys().map((key) => String(key)))
    : new Set();
  COLUMN_CACHE.set(frame, columns);
  return columns;
}

/**
 * The requirement's canonical column set when the frame carries all of it,
 * `undefined` otherwise.
 */
export function resolveRequirementColumns(
  columns: ReadonlySet<string>,
  requirement: AnalysisRequirement,
): readonly string[] | undefined {
  const required = requirementColumns(requirement);
  if (required.length === 0) return undefined;
  return required.every((column) => columns.has(column)) ? required : undefined;
}

export interface RequirementStatus {
  requirement: AnalysisRequirement;
  source: RequirementSource;
  satisfied: boolean;
  /** Columns that satisfied a `frameColumn` requirement. */
  columns?: readonly string[];
  /** Why the requirement is unmet, phrased for a tooltip. */
  detail?: string;
}

function describeMissing(requirement: AnalysisRequirement): string {
  const rendered = requirementColumns(requirement)
    .map((column) => `\`${column}\``)
    .join(", ");
  return `needs ${rendered} on the \`atoms\` block`;
}

/** Scene facts a `panelInput` requirement may depend on. */
export interface ProbeContext {
  /** Whether an atom selection is active, for requirements like `voidMask`. */
  hasSelection?: boolean;
}

/** Canonical columns a Voronoi domain label may be interned from. */
const LABEL_COLUMNS = ["element", "mol_id", "type"];

function probePanelInput(
  frame: Frame,
  requirement: AnalysisRequirement,
  context: ProbeContext,
): RequirementStatus {
  const source: RequirementSource = "panelInput";
  if (!PANEL_SUPPLIED.has(requirement)) {
    return {
      requirement,
      source,
      satisfied: false,
      detail: `this build cannot derive \`${requirement}\` from the scene yet`,
    };
  }
  const need = PANEL_INPUT_SOURCES[requirement] ?? requirement;
  const unmet = (): RequirementStatus => ({
    requirement,
    source,
    satisfied: false,
    detail: `needs ${need}`,
  });

  if (requirement === "voidMask") {
    return context.hasSelection
      ? { requirement, source, satisfied: true }
      : unmet();
  }
  if (requirement === "labels") {
    const columns = atomColumns(frame);
    const found = LABEL_COLUMNS.find((column) => columns.has(column));
    return found
      ? { requirement, source, satisfied: true, columns: [found] }
      : unmet();
  }
  // atomPairs / atomTriples / atomQuads all come from the bonds block.
  const bonds = frame.getBlock("bonds");
  return bonds && bonds.nrows() > 0
    ? { requirement, source, satisfied: true }
    : unmet();
}

/**
 * Judge each requirement of `definition` against `frame`.
 *
 * `upstreamResult` requirements are always unsatisfied — nothing in a single
 * frame can supply the output of another analysis.
 */
export function probeRequirements(
  frame: Frame | null,
  definition: AnalysisDefinition,
  context: ProbeContext = {},
): RequirementStatus[] {
  const columns = frame ? atomColumns(frame) : new Set<string>();
  return definition.requires.map((requirement): RequirementStatus => {
    const source = requirementSource(requirement);
    if (source === "panelInput") {
      if (!frame) {
        return {
          requirement,
          source,
          satisfied: false,
          detail: "no frame loaded",
        };
      }
      return probePanelInput(frame, requirement, context);
    }
    if (source === "upstreamResult") {
      return {
        requirement,
        source,
        satisfied: false,
        detail: `needs a \`${requirement}\` produced by another analysis`,
      };
    }
    const resolved = resolveRequirementColumns(columns, requirement);
    return resolved
      ? { requirement, source, satisfied: true, columns: resolved }
      : {
          requirement,
          source,
          satisfied: false,
          detail: describeMissing(requirement),
        };
  });
}

export interface AnalysisAvailability {
  runnable: boolean;
  /** Present when `runnable` is false. One line, safe to show in a tooltip. */
  reason?: string;
  statuses: RequirementStatus[];
}

/**
 * True when `frame` carries a non-empty `atoms` block.
 *
 * `System.frame` always returns a Frame object (never null) — even before any
 * file is loaded — so callers must not treat a non-null frame as "data is
 * present". This is the structure-level gate shared by availability probing
 * and the analysis UI empty state.
 */
export function frameHasStructure(frame: Frame | null | undefined): boolean {
  if (!frame) return false;
  const atoms = frame.getBlock("atoms");
  return atoms !== undefined && atoms !== null && atoms.nrows() > 0;
}

/**
 * Compact fingerprint of the structure facts that affect requirement probing.
 * Used by the page to skip re-probes when only the camera/frame index changed
 * without a topology or column change.
 */
export function structureProbeKey(
  frame: Frame | null | undefined,
  context: ProbeContext = {},
): string {
  if (!frameHasStructure(frame)) {
    return `empty|sel=${context.hasSelection ? 1 : 0}`;
  }
  // frame is non-null after frameHasStructure
  const f = frame as Frame;
  const columns = [...atomColumns(f)].sort().join(",");
  const atoms = f.getBlock("atoms");
  const bonds = f.getBlock("bonds");
  const nAtoms = atoms?.nrows() ?? 0;
  const nBonds = bonds?.nrows() ?? 0;
  return `a=${nAtoms}|b=${nBonds}|c=${columns}|sel=${context.hasSelection ? 1 : 0}`;
}

/**
 * Whether `definition` can run against `frame`, and if not, exactly why.
 *
 * A missing or empty frame (no atoms) blocks every analysis — `System.frame`
 * is never `null`, so emptiness is checked via {@link frameHasStructure}.
 */
export function analysisAvailability(
  frame: Frame | null,
  definition: AnalysisDefinition,
  context: ProbeContext = {},
): AnalysisAvailability {
  if (!frameHasStructure(frame)) {
    return { runnable: false, reason: "no structure loaded", statuses: [] };
  }
  const statuses = probeRequirements(frame, definition, context);
  const unmet = statuses.filter((status) => !status.satisfied);
  if (unmet.length === 0) return { runnable: true, statuses };
  return {
    runnable: false,
    reason: unmet.map((status) => status.detail).join("; "),
    statuses,
  };
}
