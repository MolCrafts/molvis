# Agent workflows

MolVis is a bidirectional visual workspace for human-in-the-loop molecular
work. An agent can operate the live scene through JSON-RPC; a user can inspect
the rendered result, select the atoms or bonds that matter, and return that
selection as structured molecular data.

## The review loop

```text
agent command -> RPC -> visible scene -> user selection -> event/subset -> agent
```

This closes an important gap in agent tooling: the agent does not have to infer
feedback from prose such as “the oxygen on the left.” The user points at the
actual structure, and MolVis returns the selected atom and bond IDs plus the
complete molecular subset.

## Drive the scene

The Python binding sends JSON-RPC 2.0 requests to the same frontend used by the
web and VS Code interfaces.

```python
import molvis as mv

scene = mv.Molvis(name="review")
scene.draw_frame(candidate)
scene.set_style(style="ball-and-stick")
scene.camera.fit()
scene.set_view_mode("select")
scene
```

An agent can use the same API to move the camera, seek trajectory frames, edit
the scene, configure the modifier pipeline, export structures, and capture
screenshots. Query commands wait for a typed RPC result; frontend failures are
reported as `MolvisRPCError`.

## Receive visual feedback

Wait for the user to select a region, then retrieve both its identity and its
molecular contents:

```python
event = scene.wait_for(
    "selection_changed",
    timeout=120,
    predicate=lambda value: bool(value["atom_ids"] or value["bond_ids"]),
)

feedback = {
    "frame_index": scene.current_frame,
    "atom_ids": tuple(event["atom_ids"]),
    "bond_ids": tuple(event["bond_ids"]),
    "structure": scene.get_selected(),
    "snapshot_png": scene.snapshot(),
}
```

`get_selected()` returns a standalone `molpy.Frame`, including the available
atom and bond columns. This is usually a better agent input than IDs alone:
element, position, residue, charge, and other loaded properties remain attached
to the selection.

For asynchronous applications, subscribe instead:

```python
handle = scene.on("selection_changed", send_feedback_to_agent)
# Later, when the session ends:
handle.remove()
```

Callbacks run on the transport thread. Hand long-running agent work to the
host's task queue or event loop rather than blocking the callback.

## Build an audit record

MolVis makes agent operations observable, but it does not claim to be a durable
or tamper-proof audit-log store. The host application should retain the evidence
needed by its own review policy. A useful record contains:

- timestamp, session, agent/tool identity, and RPC method;
- validated request parameters and the result or structured error;
- active frame and selection IDs;
- a snapshot for visual evidence when appearance or camera state matters;
- the user's approval, rejection, or follow-up instruction;
- any exported structure before and after a mutating operation.

Prefer explicit confirmation before destructive or expensive commands. Keep
candidate changes visible in the viewer, and use reversible pipeline operations
where possible so the user can compare and undo them.

## Security boundary

The local WebSocket uses a per-session token in its hello handshake. Treat the
token as a capability: do not log it, expose the local endpoint publicly, or
accept untrusted plugin and RPC sources. Authentication controls who may connect;
the host remains responsible for authorizing which commands an agent may issue.

Continue with [Events and cached state](events.md) for event semantics or the
[Python API reference](../../api/python.md) for commands and transport details.
