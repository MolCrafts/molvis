<!-- mol:note:topic:canvas-sceneindex -->
## [2026-08-05] Canvas WYSIWYG = SceneIndex

Fence selection used `system.frame` for atoms and metaRegistry for bonds,
so edit-only canvas atoms could not be fenced. That exposed a broader
split: canvas ops mixed SceneIndex and Frame without a rule.

**Rule**: Canvas interaction is WYSIWYG against SceneIndex; Frame is
reverse-lookup only; mismatch is an error.

### Layers

| Layer | Truth | Examples |
|-------|--------|----------|
| **A Canvas** | SceneIndex (`metaRegistry` / `meshRegistry`) | pick, fence, hover id, measure anchors, drag, highlight |
| **B Live selection** | SceneIndex logical atom/bond ids in `SelectionManager` | click, fence, live expression, Python `getSelectedMeta` |
| **C Pipeline** | Composed Frame + `selectionSet` masks | Select / Hide / Color / Delete modifiers, analysis |
| **D Reverse-lookup / export** | Scene identity → Frame row or `materializeFrameFromScene` | residue columns, `get_selected`, commit |

### Locked product choices (2026-08-05)

1. **Active producer is highlight truth.** Canvas pick/fence writes the
   live `SelectionManager` immediately, then `writeLiveSelectionToActive`
   persists it into the active manual `SelectModifier`. `applyPipeline`
   on a full rebuild re-projects that producer via `syncHighlightFromActive`
   so expression re-eval stays on the canvas. Other modes' Esc returns to
   Select and restores that highlight — they must not `SM.clear()`.
2. **Push live selection → pipeline auto-commits** when the scene is
   dirty (`confirmPendingSelection` → `commitScene` first), then remaps
   selection through dense re-index and adds `SelectModifier`.
3. **`get_selected`**: dirty or out-of-HEAD ids → materialize from
   SceneIndex with id remaps; clean dense HEAD may use Frame so extra
   columns are kept. Selected ids missing from the canvas throw.
4. **Anchored overlays** follow SceneIndex meta positions, not HEAD.
5. **Residue labels / ribbon residue expand**: columns from Frame, but
   only for atom ids that exist on SceneIndex.

### Corollaries

- Do not decide “who is selected” by reading `system.frame` alone.
- Pipeline expression modifiers (`selectFromFrame`) are **Frame** APIs;
  live `selectByExpression` is **SceneIndex**. Same string, different
  layers — do not merge silently.
- `commitScene` remaps live selection through
  `materializeFrameFromScene` atom/bond maps before clearing the edit
  pool.

**Supersedes**: ad-hoc “prefer frame when ids ∈ [0,N)” for canvas export
without checking dirty/edit-pool.
