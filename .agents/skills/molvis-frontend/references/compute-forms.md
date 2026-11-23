# Compute forms

Forms configure a scientific run. Keep the rail useful at the minimum width
from `page/src/lib/layout.ts` (currently 168px). Show at most six primary
fields, with secondary parameters under Advanced.

## Form anatomy

1. Subjects/groups/selection.
2. Primary algorithm parameters.
3. Advanced parameters, collapsed unless a required value is missing.
4. Relevant alerts.
5. Results, with stale state when inputs change.
6. Existing pinned `AnalysisRunBar` footer with explicit Run/Cancel.

Frame scope belongs in the run bar's scope slot, only when consumed by the
analysis. Hide redundant atom scope when the panel owns its own groups.
Use one shared run bar rather than a custom footer for every panel.

## Field layout

| Input | Layout |
|---|---|
| Select or long value | Full-width `ParamStack` |
| Exactly two peer short scalars | Two equal columns |
| Exactly three peer short scalars | Three equal columns |
| Derived value | Muted metadata line, not a disabled input |

Do not leave orphan grid cells. Auto placeholders are short (`Auto` or `0`);
estimates belong in `ParamStack.caption` or the run summary. Put units in
labels and use tabular numeric text. Do not expose every catalog schema field
at equal weight or duplicate a full algorithm form in both side panels.

## RDF baseline

Use Group A, Group B, Representation, and a three-column bins/r_min/r_max row.
With a box, derive g(r) density from its volume and show the derivation as
metadata. Without a box, default to p(r); explicitly requested g(r) requires a
reference volume. Empty results use a short title such as `No RDF yet`.

For pipeline-backed visual results, use the existing route in
`page/src/ui/layout/analysis/analysisRunPlan.ts` and `GenericAnalysisPanel.tsx`.
Its result and the displayed visualization must describe the same computation.
