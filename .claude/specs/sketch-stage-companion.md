---
title: Optional linked 3D pane in the Sketch editor
status: completed
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
FINISH: finish review and documentation are recorded in the surface brief.
This ordinary extension preserves the incumbent source design system; absent
root design files are reported without creating a replacement identity.
Every shipping raster must carry its provenance.

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

## Validation

- Sketch: 103 unit tests passed; Sketch viewer: 28 passed.
- Stage frame export and RPC router: 27 passed; Edit gestures: 8 passed,
  including orbiting back to the pointer origin, atomic undo, Escape and
  mode-exit camera recovery.
- Workspace build and typecheck passed; final Stage typecheck passed after
  the gesture lifecycle changes. MolRS gateway, version and Sketch bundle
  budget checks passed. Canvas-only PNG rendering was inspected separately.
- Manual checks covered default-closed state, toolbar/context-menu opening,
  both synchronization directions, close/reopen, desktop and stacked narrow
  layouts, empty-space orbit and atom-drag growth. The final desktop capture
  shows the corrected Stage HUD contrast; the stored mobile capture predates
  that shared CSS correction.
- Finish reviewer scored the reported fixes and gesture lifecycle supplement
  resolved, with disposition `ship`; this was a scoped verdict.

Explicit wedge stereochemistry remains outside the available Sketch Frame
export contract. Linked 3D reports this conversion limitation without changing
the 2D drawing. The standalone editor host owns the composition; the published
custom element and read-only/PNG surfaces retain their existing contracts.
