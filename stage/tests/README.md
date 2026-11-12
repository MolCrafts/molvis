# stage/tests — unit only

## Rules (CLAUDE.md)

- **Unit only** under `tests/`. Path mirrors `src/` (`src/foo/bar.ts` →
  `tests/foo/bar.test.ts`). Types mirror (`FooClass` → `TestFooClass` / file
  name). Single concern per test — **no e2e, multi-module façades, or full
  app boots** here.
There is no e2e or goldens lane in this repo, and none should be added — see
`.claude/notes/package-architecture.md`. Behaviour a unit test cannot reach is
a design signal, not a reason for a browser driver.

Helpers (not cases): `setup_wasm.ts`, `workload_test_helpers.ts`, `fixtures/`.

## Runner

`@rstest/core` in plain Node: no browser mode, no Playwright, no jsdom. molrs
WASM loads in Node through `setup_wasm.ts`. A test that needs the DOM, custom
elements, canvas or OPFS does not belong here — split the seam instead.

| Lane | Path | Runner |
|------|------|--------|
| Unit | `stage/tests/**` | `@rstest/core` (Node) |

## Mirror status

| Status | Area |
|--------|------|
| ✅ | `camera/`, `commands/`, `modifiers/`, `pipeline/` |
| ✅ | `io/`, `algo/`, `transport/`, `system/*` modules |
| ✅ | `selection/`, `artist/` (+ ribbon), `analysis/` |
| ✅ | `overlays/`, `export/`, `mode/`, `gizmo/` |
| ⬜ flat (top-level `src/*.ts` or multi-unit helper) | see list below |

### Intentionally flat

```
data_inspector, events, frame_render_scheduler,
selection_manager, selection_reconciler, selection_context, system,
atom_source_element_cache, build_frame_from_scene, impostor_*,
rpc_style_scope
```

When adding tests for a nested module, place them under the mirror path.
Do **not** reintroduce `tests/integration/` or boot a full `new MolvisApp`
pipeline here — split the seam instead.
