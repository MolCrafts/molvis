# UI Guidelines — MolVis

Product-local UI record, maintained by `/mol:ui`. Human prose may be added
outside the managed markers and is preserved on future runs.

<!-- mol:ui:begin -->

## Surface

| | |
|---|---|
| Frontend root | `page/` |
| Archetype | `viewer` |
| Default theme | dark, with a user-selectable light theme |
| Token layer | `page/src/styles/tailwind.css` |
| Last ladder stage applied | `states` on `2026-07-29` |

## Accent

```css
:root { --molvis-accent: oklch(0.52 0.12 195); }
.dark { --molvis-accent: oklch(0.52 0.09 195); }
```

Hue 195 stays outside the running-status exclusion band. Dark mode uses a
gun-metal surface stack (canvas/panel ≈ L 0.30–0.38) with a deeper teal fill
and light-on-accent labels — not neon cyan on pure black.

## Token decisions

MolVis owns an independent OKLCH token layer. `canvas`, `panel`, and
`panel-raised` express viewer depth; `interactive` is the neutral hover
surface, so the product accent is reserved for emphasis and selection. The
fixed status vocabulary has separate accessible foreground and soft-surface
tokens. UI text uses the 11–24px semantic ramp, controls use named 28/32/36px
heights, and coarse-pointer controls expand to a 44px minimum target.

Scene backgrounds, molecular representation colors, element colors, and
scientific color maps remain rendering data rather than UI theme tokens.

## Layout shell

The viewer uses a 44px global toolbar above a symmetric three-region work
surface: a persistent **Compute** panel on the left (molrs-aligned name; was
Analysis), the molecular canvas in the center, and a tool inspector with mode
tabs on the right. Compute starts collapsed at 0% but keeps a resident left
resize rail so it can be pulled out; the right inspector starts at 15%, leaving
canvas share from `SIDE_PANEL` (left compute = right tools — one token set:
min 15% / max 30% / openDefault 15%; canvas floor `100 − max`). Below 1280px
with a fine pointer, or 1580px
with a coarse pointer, the same persistent panel instances become
focus-managed edge drawers so compute results and edit drafts survive layout
changes. Open state is shared across
wide/narrow; presentation switches only. Side panels open and close via the canvas
edge drag rails (center grip pill on the hairline), plus scrim and Escape while
drawered — neither panel spends its 28px header band on an in-panel close
action. Both panels head with the same glyph-only `PanelTabStrip` in the 28px header
band. Tabs **share the full width evenly** (`flex-1` each) — never packed left
with empty space on the right. A strip of two and a strip of six keep one
rhythm as the panel is resized. Drawer open focuses the panel for the modal
trap but paints no full-panel ring. The bottom workbench strip appears only when a plugin
registers content. Status and trajectory controls share one 28px bottom region.

## Product components

| Component | Wraps | Owns |
|---|---|---|
| `ViewerToolbar` | semantic viewer actions, badges, separators, dialog triggers | Product identity, history, theme, capture, export, reset, and fullscreen actions |
| `ViewerToolButton` | local `Button` + `Tooltip` primitives | Compact tool geometry, accessible naming, and a high-contrast active state |
| `PanelTabStrip` | `TabsList` + `TabsTrigger` + `Tooltip` | The glyph-only side-panel tab band: accent glyph over a hairline underline, wording in the tooltip and accessible name |
| `StructureInspector` | `Tabs` + `PanelTabStrip` + lazily retained mode panels | The right-side mode switcher and each tool's persistent inspector state |
| `ViewerSidePanel` | resident panel / modal drawer semantics | One state-preserving side-panel surface across wide and narrow layouts |
| `TrajectoryTimeline` | `Slider`, speed selection, semantic playback actions | Frame position, navigation, playback, and playback speed |
| `AtomSelectionBadge` | neutral `Badge` + live selection subscription | The current atom-selection count and its accessible announcement |
| `ColorScaleLegend` | the scientific color-map registry | Scientific scale samples and formatted property bounds without theme remapping |

Feature code uses the local semantic action vocabulary `ViewerAction`,
`ViewerToggleAction`, `ViewerIconAction`, and `ViewerToolButton`; shadcn
appearance props stay inside that product layer. Fullscreen exit and chart
pop-out use dedicated domain actions so overlay/touch-target treatments do
not leak into features. Scene-load combine choices are plain text
`ViewerAction` buttons (Replace / Add / Extend) — no icon-only row.

## Operation states

Transient tips (running / success / error callouts for pipeline work, 3D
generation, structure download, file load) land in the **bottom status bar**
only — never floating toast cards or in-panel alert bubbles. Success flashes
the status bar green briefly (`status-bar-flash-success`); errors tint it red
and stay until the next message. Emit via `app.events.emit("status-message", …)`
when a Molvis instance is available, or `reportStatus` / `useReportOperationStatus`
for React-only surfaces.

`ViewerOperationState` remains for **in-context form surfaces** only (dialogs,
analysis empty/error panes, trajectory timeline errors) where the feedback is
bound to a control group, not a global tip. `useViewerOperation` still owns
local transitions, retry, and the paint-before-work yield. Pipeline and
representation changes use `PipelineOperationProvider`, which reports to the
status bar while the initiating panel disables conflicting controls.

Analysis run bars may keep their compact progress affordance, but their
alerts and determinate progress remain live and machine-readable.

**Save is the only user-facing verb** for pushing canvas edits into the
structure. `commitScene()`, `purpose="commit"`, and `DataSource` are internal
names and never appear in copy — a panel says "Unsaved edits" and offers
"Save scene", never "not committed" / "Commit scene". Blocked-state copy names
the state and the remedy only; it does not explain the data model.

The 2D sketch composer uses glyph-only chrome; operational wording appears only
in accessible tooltips. Active tools use accent fill plus `aria-pressed`, and
Chain's tooltip explicitly describes its press-drag/farther-means-longer
gesture. Busy state disables both pointer and previously focused keyboard
mutation. Color is a parallel override toggle rather than an exclusive tool:
the active drawing tool stays highlighted, enabled color affects new or selected
atoms and bonds, and disabled color restores defaults for the current
selection. The composer has no freeform-text tool.

## Motion

MolVis chrome uses the local 120/150/180ms motion tokens and the standard
`cubic-bezier(0.2, 0, 0, 1)` easing. Anchored overlays move eight pixels from
their trigger edge, centered dialogs and scrims fade, and the contextual
inspector enters from the edge it belongs to. State surfaces use a short
opacity transition; determinate progress and loading indicators remain linear.
Pipeline dragging uses the same 150ms spatial transition.

`prefers-reduced-motion: reduce` removes chrome transitions, transforms, and
spinner animation entirely while preserving labels and final state. WebGL
camera easing and trajectory playback remain exempt because they are the
scientific subject matter rather than decorative chrome.

## Base primitives installed

`button`, `input`, `select`, `checkbox`, `switch`, `tooltip`, `popover`,
`dropdown-menu`, `dialog`, `tabs`, `separator`, `scroll-area`, `resizable`,
plus the existing viewer needs `label`, `slider`, `badge`, `empty-state`,
`code`, and `number-field`.

## Permitted variance claimed

| Axis | This product | Rationale |
|---|---|---|
| Default theme | Dark, with light available | The molecular canvas is the primary work surface |
| Layout topology | Symmetric Analysis / canvas / tabbed-tools shell | Keeps analysis and editing controls visible around the scientific work surface |
| Information density | Canvas-first, low-presence chrome | Structure observation remains the dominant task |
| Panel behavior | Resizable inline side panels; focus-managed edge drawers when narrow | Preserves panel state and canvas continuity across embedded hosts |
| Product component set | Local to `page/` | MolVis owns viewport-specific interaction components |

## Known debt

| Item | Stage | Severity |
|---|---|---|
| `DataInspectorPanel` coarse-pointer row geometry and selection semantics diverge from its virtualized 20px rows | `states` | 🔴 |
| Empty pipeline and atom-table views still need explanatory empty states | `states` | 🟡 |
| Core container resize calls are not yet coalesced during live two-rail drag | `skeleton` | 🟡 |

<!-- mol:ui:end -->

## Right inspector copy (View-aligned)

All mode tabs (View / Select / Edit / Measure / Manipulate) and pipeline
properties use the **same density as View**:

- Controls first; no tutorial paragraphs in the rail.
- Empty states: short title only (`No selection`, `Select an item`) — no
  multi-line how-to. Remedies live in tooltips / aria-label when needed.
- Status lines stay compact (`N atoms · N bonds`, tabular nums).
- Help for expressions / advanced params goes in `title` / tooltip, not
  body prose under the field.

## Compute rail (left panel)

Product name is **Compute**, aligned with molrs/molpy `compute/`. Internal
module paths may still say `analysis` until a later rename pass; user-facing
copy, shell mode, and layout ids use `compute`.

Form design rules (narrow ~240–320px): see
`.claude/notes/compute-form-design.md` (PM + scientist + web-design
synthesis). Hard rules:

- Full-width stacks by default; numeric peer fields use equal grids
  (`grid-cols-3` for bins / r_min / r_max — never 2-col with an orphan).
- Auto estimates live as `ParamStack` captions under the control, never as
  long overflowing placeholders.
- Derived values (box volume → ρ) are one-line captions, not fake locked
  inputs.
- Empty states: title only.
