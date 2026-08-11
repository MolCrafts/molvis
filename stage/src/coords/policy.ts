/**
 * Product coordinate policies applied after DataSource compose and before
 * transform/draw modifiers. Default is as-deposited (no silent wrap).
 */

export type CoordinatePolicy =
  | "as-deposited"
  | "wrap-atoms"
  | "wrap-molecules"
  | "unwrap-trajectory";

export const COORDINATE_POLICIES: readonly CoordinatePolicy[] = [
  "as-deposited",
  "wrap-atoms",
  "wrap-molecules",
  "unwrap-trajectory",
] as const;

export const COORDINATE_POLICY_LABELS: Record<CoordinatePolicy, string> = {
  "as-deposited": "As deposited",
  "wrap-atoms": "Wrap atoms",
  "wrap-molecules": "Wrap molecules",
  "unwrap-trajectory": "Unwrap trajectory",
};

export function isCoordinatePolicy(value: string): value is CoordinatePolicy {
  return (COORDINATE_POLICIES as readonly string[]).includes(value);
}
