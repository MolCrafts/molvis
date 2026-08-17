# Headless rendering

Deterministic offscreen snapshots and turntables, for figures, regression
images, and animations.

There is one honest caveat to state up front: **MolVis has no true headless
renderer.** Every capture path below renders in a real WebGL context and reads
the canvas back. What "headless" means here is *scripted and reproducible* —
you drive the camera and the frame index rather than pointing and clicking —
not *without a browser*. Running on a machine with no display means running the
page in headless Chromium, not bypassing it.

## The one primitive

Everything is built on a single RPC method:

| Method | Returns |
|--------|---------|
| `snapshot.take` | the current canvas as a PNG data URL |

It captures **whatever is currently on screen**. It takes no frame index and no
camera pose, which is the fact that shapes every workflow below: to capture
frame *N* from pose *P*, you must set the pose, seek to *N*, wait for both to
land, and only then capture. There is no combined call, and adding one would
mean the renderer guessing when the scene had settled.

## From Python

```python
from molvis import Molvis

mv = Molvis()
mv.draw_frame(frame)

png: bytes = mv.snapshot()          # blocks until the page answers
open("figure.png", "wb").write(png)
```

`snapshot()` blocks on a round trip and raises `TimeoutError` if the page does
not answer within `timeout` (default 5 s). The first snapshot after
constructing a viewer in the same cell is the one most likely to time out — the
page bundle only starts loading once the cell's output is flushed, so give the
viewer a cell of its own, or raise the timeout.

### Animations

`render_animation` is the seek → pose → capture loop, wired to ffmpeg:

```python
from molvis.control import CameraPose

mv.render_animation("traj.mp4", fps=30)          # every frame, fixed camera

mv.render_animation(
    "turntable.mp4",
    frame_indices=[0] * 120,                     # one frame, camera moves
    camera_path=[
        CameraPose(alpha=i * 2 * math.pi / 120, beta=1.2, radius=40,
                   target=(0.0, 0.0, 0.0))
        for i in range(120)
    ],
    fps=30,
)
```

`frame_indices` defaults to the whole trajectory; `camera_path` is either
`None` (camera untouched) or a sequence of the **same length** as
`frame_indices`. A length mismatch raises `ValueError` rather than silently
truncating.

A turntable is therefore just a constant `frame_indices` with a varying
`camera_path`, and a trajectory playback is the reverse. Both go through the
same loop.

Angles follow MolVis's Z-up convention: `alpha` is the azimuth in the XY
plane, `beta` the polar angle from +Z.

### Video encoding

`render_animation` streams PNGs into `molvis.video.write_video`, which pipes
them to ffmpeg. ffmpeg is resolved from `PATH` first, then from the binary
vendored by `imageio-ffmpeg`; if neither is present you get
`FfmpegNotFoundError` rather than a broken file. `write_video` is usable on its
own if you already have frames:

```python
from molvis.video import write_video
write_video([png_bytes, ...], "out.mp4", fps=24)
```

## From the browser

The page's screenshot dialog uses the same capture path and adds resampling,
alpha-bounds cropping and DPI metadata for publication figures.

Two constraints are worth knowing before scripting captures in a page:

- **Capture is one frame behind an un-awaited change.** Anything that mutates
  the scene must have settled before you call `snapshot.take`; a pipeline
  recompute is asynchronous.
- **Browsers cap simultaneous WebGL contexts.** Each `molvis-viewer` owns an
  engine, so a grid of independent viewers will start losing contexts. For many
  read-only tiles use `molvis-style-gallery`, which maps many visible canvases
  onto one hidden WebGL canvas. See
  [Lifecycle](../interfaces/web/lifecycle.md).

## Reproducibility

For images you intend to diff or publish, pin everything that moves:

- **Camera** — set an explicit `CameraPose`. `camera.fit` depends on the
  current frame's extents, so it is not stable across a trajectory.
- **Frame** — seek explicitly; do not rely on playback position.
- **Style and theme** — set them, rather than inheriting whatever the session
  had.
- **Canvas size** — snapshots are canvas-sized, so a resized window changes
  the output.

Note that a pipeline whose modifiers hold random state (clustering seeds, for
example) will not produce identical images across runs even with all of the
above pinned. Seed those modifiers explicitly if you need bit-identical output.
