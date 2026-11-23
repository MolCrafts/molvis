---
version: 1
slug: "sketch-viewer-src-python-page-entry-ts"
primary_target: "sketch-viewer/src/python/page_entry.ts"
related_targets: ["sketch-viewer/src/python/sketch_editor.ts", "sketch-viewer/src/python/sketch_editor.css", "sketch-viewer/src/python/stage_companion.ts"]
---

---
title: Optional linked 3D pane in the Sketch editor
status: reviewed
created: 2026-11-19
---

The standalone Sketch editor keeps its existing chemical drawing tools and
adds an optional editable Stage on the right. A toolbar toggle and a canvas
context-menu toggle control the same state. The pane starts closed, is not
restored automatically, and does not load Stage until explicitly opened.
Read-only previews and canvas-only PNG rendering keep their current surface.

The host composes the peer engines; neither engine imports the other. Reuse
SketchComposer, MoleculeGraph Frame IO, Conformer, Stage's source ingress,
export_frame, edit modes and history. Synchronize chemical edits both ways;
camera changes, selection, and 2D layout changes must not regenerate 3D.
Serialize updates, suppress feedback, surface failures, and unsubscribe and
release the Stage when closed. Preserve 2D undo when importing Stage edits.

## Direction contract

THESIS: One chemical document, with an optional second editable view.
OWN-WORLD: Inherit Sketch's white drawing paper, slate tool rails, teal active
controls, system UI typography, compact SVG icons and one-pixel dividers.
STORY: Draw normally, open 3D from the toolbar or right click, and edit either
view while seeing the same connectivity. Close 3D to regain the paper.
FIRST VIEWPORT: Existing Sketch fills the editor by default. When enabled,
Sketch occupies the left 55%, an adjustable divider separates the right 3D
pane, and a compact header names the view and exposes its close action.
Narrow windows stack the two views without shrinking their tools away.
FORM: Local extension of the established chemical drawing editor; the brief
pins the ChemDraw-like tool/large-canvas arrangement. No concept seed needed.
FINISH: record the finish verdict and evidence here. This ordinary extension
preserves the incumbent source design system; it does not create a new
DESIGN.md or sidecar. Every shipping raster must carry its provenance.

## Acceptance

- Starts closed; no Stage construction or import until a user opens it.
- Toolbar and accessible context menu open and close the same pane.
- Both views remain editable; connectivity changes propagate both ways.
- In Stage Edit mode, empty-space dragging rotates; atom dragging grows a
  bond and atom as one reversible edit, or connects an existing target.
- Navigation and layout edits preserve the other view's geometry.
- Empty documents, undo/redo, failed embedding, rapid changes and closing
  during initialization/update do not lose the drawing or leak a Stage.
- Node unit tests isolate synchronization through fake endpoints; package
  builds/types and a bounded manual browser check verify the shipped shell.

## Finish record — 2026-11-19

Disposition: ship for the reviewed fixes: current drawing styling and stable
atom identity during Stage updates, coherent fresh 2D layout, recovery to
ready after undo, Stage Edit HUD contrast, product documentation, and Stage
editing gestures. This is a scoped finish verdict, not a claim of exhaustive
chemistry or browser coverage.

### Incumbent system preserved

The source system remains `sketch/src/style/tokens.ts` and
`sketch/src/ui/styles.ts`: white drawing paper, slate rails, teal active
controls, system UI type, compact SVG tools, and thin dividers. The host reuses
`SketchComposer` and its existing `.msk-btn` control in the toolbar. The linked
pane adds a compact 12px title, 11px linked label, 12px status text, and a 6px
adjustable separator. Its initial 55:45 split becomes a vertical stack at
720px. Closing Stage returns the full paper to Sketch.

No incumbent `DESIGN.md` or `.impeccable/design.json` exists at the project or
app root. That pre-existing documentation absence is recorded without
inventing a brand metaphor, new token vocabulary, or replacement system.
Local host fallback and state colors are implementation details, not newly
canonized primitives. No root design files were created or changed.

### Evidence and limits

- `review/default.png` records the closed Stage and the incumbent drawing
  tools. `review/desktop.png` records the final open pane, linked 2D drawing,
  ready status, and light Edit HUD text on the dark Stage.
- `review/mobile.png` and `review/mobile-full.png` record the narrow stacked
  layout before the final HUD contrast fix. They do not verify the final
  narrow HUD color. The shared `.msk-editor__stage` rule now sets
  `--molvis-ui-panel-fg: #edf7f7`; the final desktop capture shows that fix.
  The browser lost its native window before another narrow capture.
- The finish handoff reports eight passing Stage gesture unit tests,
  including Escape cancellation and leaving Edit mode restoring camera
  control. The test source is `stage/tests/mode/edit.test.ts`; this
  documentation pass did not rerun tests or the browser.
- The finish handoff reports one detector pass returning `[]` for the
  changed TypeScript and CSS. This documentation pass did not rerun it.
- The final handoff reports a successful `build:sketch-page`, copied into
  local Python resources, passing changed Stage type/Biome checks and
  `git diff --check`, and a ship disposition for the gesture lifecycle
  supplement. No UI source changed after the reviewed captures.
- No generated or stock raster ships in this feature. The PNGs above are
  local browser evidence, not product imagery.

Wedge stereochemistry remains the documented unsupported conversion case:
the linked pane exposes the limitation and preserves the 2D drawing. The
older narrow HUD contrast in the evidence is not a design-system rule.
