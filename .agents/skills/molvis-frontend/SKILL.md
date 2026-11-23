---
name: molvis-frontend
description: Build MolVis application panels and viewer chrome using existing components and product conventions. Use when editing React UI, responsive side panels, Compute forms, operation status, inspector controls, or embedded viewer interactions.
---

# MolVis frontend

## Locate the existing surface

Use package APIs for engine behavior. Reuse the existing page components:
`ViewerToolbar`, `ViewerToolButton`, `PanelTabStrip`, `StructureInspector`,
`ViewerSidePanel`, `EdgePanel`, `WorkbenchBottomPanel`, `TrajectoryTimeline`,
`AtomSelectionBadge`, and `ColorScaleLegend`. Search the local module and
shared UI package before adding another primitive.

## Layout and interaction

- Keep Compute on the left, canvas central, and the tool inspector on the
  right. Compute starts collapsed. Preserve panel instances, drafts, results,
  and scroll state while switching between wide panels and narrow drawers.
- Use sizing tokens from `page/src/lib/layout.ts`, including
  `SIDE_PANEL_MIN_PX`; avoid local width formulas. Check the affected layout
  at its minimum width.
- Use theme tokens from `page/src/styles/tailwind.css`. Molecular element/data
  colors and scene background are rendering data, independent of UI theme.
- Tabs and glyph-only tools need accessible names, tooltips, keyboard focus,
  and accurate pressed/selected state. Busy operations disable pointer and
  keyboard mutation, including controls that already have focus.
- Sliders preview locally and run expensive pipeline work on release/commit.
  Keep number-input commits and undo behavior consistent with that pattern.
- Use existing motion tokens. Reduced-motion removes decorative transitions
  and spinner animation while retaining labels and final state.
- Keep the Stage canvas context menu in its existing web component. The page's
  pipeline add menu remains a separate popover using the same compact density.

## Operations and language

- Use `useViewerOperation`, `useReportOperationStatus`, and the existing
  `PipelineOperationProvider` for operation lifecycle and conflicting controls.
  Engine operations report through `status-message`/`reportStatus`.
- Global operation status has one `ViewerStatusOverlay` message. Keep
  determinate progress and alerts accessible; do not add a permanent status
  strip or duplicate toasts for the same operation.
- Product copy says **Compute**; internal `analysis` names and stable catalog
  IDs need not be renamed. Display/doc lookup keys may be literal data;
  algorithm dispatch reuses `stage/src/analysis/analysis_ids.ts` constants.
- Product copy says **Save scene** and **Unsaved edits**. Keep `commitScene`,
  DataSource, and internal pipeline mechanics out of user-facing explanations.
- Controls come first. Use short title-only empty states and compact status
  lines. Put advanced help in tooltips or existing docs links.

Read [Compute forms](references/compute-forms.md) when changing a scientific
form. Use [molvis-rendering](../molvis-rendering/SKILL.md) for visual controls
and [molvis-validation](../molvis-validation/SKILL.md) for verification.
