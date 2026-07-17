# Events and cached state

The browser sends interaction notifications back to Python. `Molvis` updates a
local state cache before invoking callbacks, so reading `scene.selection` does
not require a second RPC roundtrip.

## Subscribe

```python
def report_selection(event):
    print("atoms:", event["atom_ids"])
    print("bonds:", event["bond_ids"])

handle = scene.on("selection_changed", report_selection)
```

Remove the callback explicitly when its owner is disposed:

```python
handle.remove()
```

Callbacks run on the transport's asyncio thread. Do not update non-thread-safe
notebook or GUI state directly from a long callback; hand work off to the host
event loop.

## Wait for one interaction

```python
event = scene.wait_for(
    "selection_changed",
    timeout=30,
    predicate=lambda value: len(value["atom_ids"]) >= 2,
)
```

`wait_for` suits linear teaching and analysis workflows: prompt the user, wait
for a specific state, then continue computation.

## Read cached state

```python
scene.selection
scene.current_mode
scene.current_frame
scene.n_frames
```

Call `scene.refresh_state()` only when you require an explicit frontend
roundtrip. Normal event flow keeps the cache current.

## Handle command errors

Synchronous query commands raise `MolvisRPCError` when the frontend returns a
JSON-RPC error:

```python
try:
    current = scene.export_frame()
except mv.MolvisRPCError as error:
    print(error.code, error)
```

Continue with [Video encoding](video.md).
