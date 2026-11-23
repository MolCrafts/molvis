# MolRS handle ownership

MolRS objects live in WASM. A JavaScript wrapper is a handle into that memory;
`Block` and column views borrow memory owned by a Frame.

## Retain one owner per logical object

Every path materializing a Frame, Trajectory, Box, or other durable MolRS object
must retain it under an explicit frontend owner: `System.trajectory`, a
SceneIndex source, an async frame cache, an undo snapshot, or another named
owner keyed by logical identity.

| Object | Ownership rule |
|---|---|
| Current trajectory frame | System and SceneIndex sources retain its Frame |
| Frame columns | Retain the Frame and rederive Blocks on read |
| Stream frame by index | Reuse its trajectory-cache entry |
| One-shot compute result | Retain an owner, or copy all output into JS buffers before freeing |

Do not create a second MolRS object describing the same logical entity merely
for another reader. Reuse an existing handle when identity is unchanged. Update
through the owning API when mutation is allowed. When identity changes, replace
the owner's reference; other readers may still need the previous handle.

This ownership rule does not make pipeline transforms mutable: a transform
that produces new frame data still returns a new result with a clear owner.

## Borrowed views

Keep the owning Frame and call `frame.get(...)` for each read. Never cache
Blocks or column views across frame mutations, metadata writes, or frame
replacement. Never call `free()` on a borrowed Block.

## Explicit release

Do not free an object while the pipeline, Artist, SceneIndex, analysis, or an
async consumer can still observe it. LRU eviction drops the cache reference;
it does not free a Frame still bound by the canvas. A delayed rAF or microtask
does not establish exclusive ownership. FinalizationRegistry is a backstop,
not a substitute for retaining owners.

Explicit `free()` is appropriate for local ephemerals after their entire useful
payload has been copied to JS-owned buffers and no other module received the
handle: prepare → copy → free → return JS data.

Owned readers and caches may also free their objects at teardown after every
consumer has moved off them. Preserve the ordering in `installPrimaryTrajectory`
in `stage/src/io/index.ts`: replace the scene and its last-rendered Frame first,
then run the outgoing reader's cleanup. Do not confuse cache eviction with
this complete handoff.

## Existing implementations

- `stage/src/entity_source.ts`: retains Frame, rederives Block on read.
- `stage/src/scene_index.ts`: registers owning Frames in source registries.
- `stage/src/system/trajectory.ts`: owns the asynchronous frame cache.
- `core/src/molrs.ts`: public WASM gateway and borrowed-view contract.

For canvas identity and edit ownership, see
[SceneIndex](../../molvis-rendering/references/canvas-sceneindex.md).
