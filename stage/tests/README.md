# stage/tests — unit only

## Rules (CLAUDE.md)

- **Unit only** under `tests/`. Path mirrors `src/` (`src/foo/bar.ts` →
  `tests/foo/bar.test.ts`). Types mirror (`FooClass` → `TestFooClass` / file
  name). Single concern per test — **no e2e, multi-module façades, or full
  app boots** here.
There is no e2e or goldens lane in this repo, and none should be added — see
`.claude/notes/package-architecture.md`. Behaviour a unit test cannot reach is
a design signal, not a reason for a browser driver.

Helpers (not cases): `setup_wasm.ts`, `io/cache/opfs_test_helpers.ts`.

## Runner

`@rstest/core` **browser mode** (`@rstest/browser` + Playwright Chromium) so
WASM and DOM APIs work. This is still unit/component testing — the test body
runs *inside* the page bundle, not against a deployed app.

| Lane | Path | Runner |
|------|------|--------|
| Unit | `stage/tests/**` | `@rstest/core` + browser mode |

## Mirror status

| Status | Area |
|--------|------|
| ✅ | `camera/`, `commands/`, `modifiers/`, `pipeline/` |
| ✅ | `io/`, `algo/`, `transport/`, `system/*` modules |
| ✅ | `selection/`, `artist/` (+ ribbon), `analysis/` |
| ✅ | `overlays/`, `export/`, `mode/`, `ui/`, `gizmo/` |
| ⬜ flat (top-level `src/*.ts` or multi-unit helper) | see list below |

### Intentionally flat

```
data_inspector, element, events, frame_render_scheduler,
selection_manager, selection_reconciler, selection_context, system,
atom_source_element_cache, build_frame_from_scene, impostor_*,
rpc_style_scope, app_modifier_toggle (static method only)
```

When adding tests for a nested module, place them under the mirror path.
Do **not** reintroduce `tests/integration/` or boot a full `new MolvisApp`
pipeline here — split the seam instead.
