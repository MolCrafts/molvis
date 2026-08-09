# Streaming a live simulation

`set_trajectory` replaces the whole trajectory: it resends every frame, rebuilds
the pipeline, and re-frames the camera. That is right for a file you just
loaded and wrong for a run that is still going — driving an MD loop through it
costs O(N²) bytes and rebuilds the scene on every step.

`append_frame` is the streaming ingress. It sends one frame, rebuilds nothing,
and moves the camera only on the frame that creates the scene.

## The producer is Python

The direct case: your integrator and the viewer are the same process.

```python
import molvis as mv

scene = mv.Stage()
scene.set_trajectory([system.frame])        # establish the scene once

for step in range(n_steps):
    integrator.step()
    scene.append_frame(system.frame)
```

`append_frame` does not wait for the browser to acknowledge, so a fast loop is
not throttled by a round trip per step. Pass `wait_for_response=True` when a
dropped frame would be a bug rather than a skipped redraw.

Pass `follow=False` to keep the playhead where the user parked it while frames
keep arriving:

```python
scene.append_frame(system.frame, follow=False)
```

## The producer is somewhere else

When the simulation is a Rust binary, a job on a cluster, or anything that
should not also serve a web page, it publishes frames on its own socket with
[`molrs.stream.Publisher`][molrs-net] and MolVis relays them:

```text
producer ──► molrs Publisher ──ws://──► FrameStream ──► append_frame ──► browser
```

The producer side, in Python:

```python
import molrs

with molrs.stream.Publisher("127.0.0.1:8765") as server:
    for step in range(n_steps):
        integrator.step()
        server.send(system.frame)
```

`send` never blocks on the network. When a viewer cannot keep up, the oldest
buffered frame is dropped so the simulation is never throttled by rendering.

The same thing in Rust is `molrs::stream::Publisher::bind("127.0.0.1:8765")`
followed by `server.send(&frame)` — the wire format is molrs's, so either
language produces a stream MolVis can read.

The viewer side:

```python
import molvis as mv

scene = mv.Stage()

with mv.FrameStream(scene, "ws://localhost:8765") as stream:
    stream.wait_for_connection(timeout=30)
    input("streaming — press enter to stop")
```

`FrameStream` reads on its own threads, so a notebook cell or a script keeps
control. It re-dials by default: opening the viewer before the simulation
starts is the normal case, not an error.

### Keeping up

Two separate controls, for two separate problems:

| Setting | Problem it solves |
|---|---|
| `max_rate_hz=10` | The producer emits more detail than you want to watch. Deliberate downsampling. |
| `queue_size=4` | The viewer momentarily stalls. The oldest pending payload is dropped, so a slow renderer costs frames rather than memory. |

```python
mv.FrameStream(scene, url, max_rate_hz=10, queue_size=8)
```

### Talking back

A viewer can ask the producer to change what it is doing. The producer decides
what a command means — nothing in the transport acts on one.

```python
import molrs

stream.send_command(molrs.stream.ControlCommand.pause())
stream.send_command(molrs.stream.ControlCommand.set_frame_rate(30.0))
stream.send_command(molrs.stream.ControlCommand.set_subset([0, 1, 2]))
```

On the producer side:

```python
cmd = server.recv_command(timeout=0.0)      # 0.0 polls, returns immediately
if cmd is not None and cmd.kind == "pause":
    paused = True
```

### When nothing arrives

A stream that reconnects can otherwise stay silent forever. `last_error` says
why:

```python
stream.wait_for_frames(1, timeout=10)       # raises TimeoutError with the reason
print(stream.frames_received, stream.frames_forwarded, stream.frames_dropped)
print(stream.last_error)
```

## What a streamed frame is not

Two things behave differently from a loaded trajectory, both deliberately:

- **Streamed frames are not kept for reconnect.** A browser that reloads
  mid-stream shows whatever `set_trajectory` last established until the next
  frame arrives. Retaining the run would hold every frame in Python memory and
  re-serialize all of it on each reload.
- **A streamed `Frame` must not be retained.** It is valid for the duration of
  the call and no longer — it belongs to the relay's worker thread. Copy what
  you need inside the call (`np.array(frame["atoms"]["x"])`) rather than
  keeping the frame.

[molrs-net]: https://github.com/MolCrafts/molrs
