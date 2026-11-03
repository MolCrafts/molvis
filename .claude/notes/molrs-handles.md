<!-- mol:note:topic:molrs-handles -->
# molrs handles — sink once, track, reuse

## Why

molrs objects (`Frame`, `Trajectory`, `Box`, `Block` views, grid blocks, …)
live in WASM. The JS wrapper is only a handle into that memory.

- **Timely `free()` is hard.** Consumers race: SceneIndex, Artist, AtomSource,
  analysis, async trajectory LRU, and pipeline all may still hold a reference
  between `frame-change` and the next `setFrame`. Explicit free under load
  produces use-after-free / "Invalid block handle" / silent corruption.
- **Duplicate sinks are worse.** Creating a second `Frame` (or Box, …) that
  describes the *same* logical entity leaves two WASM objects for one truth;
  updates hit one path, readers the other, and free becomes ambiguous.

`wasm-bindgen`'s `FinalizationRegistry` can reclaim when the last JS wrapper
is GC'd. That is a backstop, not a lifecycle plan. The plan is **handles**.

## Rule

**Every sink keeps a frontend handle. Second touch updates or reuses — it does
not re-create. Do not free for "hygiene" while any reader might still hold the
object.**

### Sink

A *sink* is any path that materializes a molrs object into the TS layer, e.g.:

- load / stream / RPC → `Frame` / `Trajectory`
- empty-scene bootstrap → head `Frame`
- sketch commit / edit / optimize → working `Frame`
- analysis / modifier that builds a derived frame or box
- temporary molrs results that outlive one stack frame

When the sink returns, **some durable owner on the frontend must retain the
handle**: `System.trajectory`, `MetaRegistry` / `AtomSource.frame`,
trajectory async LRU, a command's undo snapshot, a named cache keyed by
logical identity — not a local that goes out of scope while others still
read.

### One object per logical entity

| Logical thing | Frontend owner (examples) | Do not |
|---|---|---|
| Trajectory HEAD / playhead frame | `System` + SceneIndex sources | `new Frame()` clone "for safety" on every reader |
| Frame atom/bond columns | store **Frame**; re-derive `Block` on read | cache `Block` across `setMeta` / `with_frame_mut` |
| Async stream frame `i` | Trajectory LRU by index | free on LRU eviction while Artist still binds that frame |
| Ephemeral molrs result (perceive, one-shot compute) | local only **after** snapshot to JS-owned buffers | return a bare Frame with no owner and hope the caller frees |

`Block` handles are **borrows** of a Frame. They are not sinks of their own
identity — never store them; re-fetch via `frame.getBlock(...)` (see
`stage/src/entity_source.ts`).

### Update / reuse, not free+recreate

On the second (nth) write for the same logical entity:

1. **Reuse** the existing handle if identity is unchanged (same trajectory
   index, same primary DS frame, same cached key).
2. **Update in place** when the API allows (column set, positions, meta) and
   the changeKind path can buffer-update.
3. **Replace** the handle in the owner map (`setFrame`, trajectory slot,
   cache entry) when identity truly changes — drop the old reference from the
   owner so GC / FinalizationRegistry can run; do **not** call `free()` while
   other layers may still observe the previous frame for one more tick.

### When `free()` is allowed

Only for **true ephemerals** whose entire useful payload has already been
copied into JS-owned memory (`Float64Array`, plain objects, undo buffers),
and no other module received the molrs handle. Pattern:
`prepare → copy columns → free() → return JS data` (e.g. place-molecule
Kekulé prepare). If any other layer might have seen the object, do not free.

## Evidence already in tree

- `stage/src/entity_source.ts` — store Frame; re-derive Block every read.
- `stage/src/scene_index.ts` — `registerAtomFrame` keeps owning Frame in
  MetaRegistry, not borrowed Blocks.
- `stage/src/system/trajectory.ts` — async LRU **must not** `frame.free()` on
  eviction; races with SceneIndex / Artist between events.
- Docs API note that molrs classes own WASM memory — that is the contract for
  *authors of one-shot scripts*, not a license for stage to free mid-pipeline.

## Anti-patterns

- `new Frame()` / re-parse to "describe the same structure" on each consumer.
- Cache `Block` or `viewCol*` results across any frame mutation.
- `frame.free()` in dispose paths that run while the pipeline or canvas still
  points at that frame.
- "I'll free it in a rAF / microtask" as a substitute for ownership.
- Building a derived molrs object for analysis and never registering it under
  a named owner (leak + second sink next run).

## Related

- Invariant router: `CLAUDE.md` → **molrs handle tracking**.
- Canvas identity: [canvas-sceneindex.md](./canvas-sceneindex.md) (SceneIndex
  is the canvas truth; frame handles are the data truth).
- Immutability of *domain transforms* still holds at the pipeline level
  (return new frame data when the pipeline requires it) — that is not
  "orphan a WASM object without an owner."
