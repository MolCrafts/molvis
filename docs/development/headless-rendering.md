# Headless rendering

Deterministic offscreen snapshots and turntables, for figures, regression
images, and animations.

Every capture path below renders in a real browser — WebGL for the stage, a
2D canvas for the sketch — and reads the result back. On a machine with no
display (a coding agent's terminal, CI, an HPC login node) molvis starts that
browser itself: headless Chromium, driven by Playwright, loads the bundled page
and dials back over the same WebSocket a tab would use. WebGL runs on
SwiftShader, Chromium's software rasterizer, so no GPU or display server is
needed.

## Setup

Headless rendering is an optional extra:

```bash
pip install 'molcrafts-molvis[headless]'
python -m playwright install chromium     # once per machine, no root needed
```

`MOLVIS_CHROMIUM=/path/to/chrome` uses an installed Chrome/Chromium instead of
the one Playwright downloads. When either piece is missing, the first command
raises `HeadlessBrowserUnavailable` naming these commands.

## When molvis goes headless

| Where | `headless` default | Behaviour |
|-------|--------------------|-----------|
| `MOLVIS_HEADLESS=1`, or Linux with no `DISPLAY`/`WAYLAND_DISPLAY` | `True` | headless Chromium from the first command |
| script / REPL with a display | `None` | opens a tab; falls back to headless Chromium only if no page attaches in time |
| notebook (inline) | `False` | never starts a browser of its own |

`Stage(headless=True)` / `Sketch(headless=True)` force it anywhere; `False`
restores the old "wait for a page connected by hand" behaviour. A headless
stage defaults to `gui=False` (canvas only), and its page is `width` x
`height` CSS pixels — the size of `snapshot()`.

```python
import molpy as mp
import molvis as mv

mol = mp.io.smiles.read_smiles("c1ccc(CCC[N+](C)(C)C)cc1").to_atomistic()
mol3d, _ = mp.conformer.Conformer(seed=7).generate(mol)

stage = mv.Stage(name="fig", headless=True, width=900, height=700)
stage.draw_frame(mol3d)
stage.fit()                                   # frame the whole molecule
open("cation.png", "wb").write(stage.snapshot(timeout=30))

board = mv.Sketch(name="fig2d", headless=True)
board.load_smiles("c1ccc(CCC[N+](C)(C)C)cc1.[OH-]")
board.export_svg("cation.svg")
board.export_png("cation.png", width=600, height=400)
```

From the shell, `--output` always renders headlessly:

```bash
molvis stage structure.xyz --output shot.png --width 800 --height 600
```

!!! warning "Nullable columns"
    The wire refuses nullable columns (`validity` masks). molpy frames from
    SMILES or PDB carry some (`is_aromatic`, `h_count`, `formal_charge`), so
    `draw_frame` raises `WireError` on them until the caller makes every cell
    valid (`block.set_validity(key, [True] * block.n_rows)`). The sketch is
    not affected: it reads molpy structures itself.

## 2D: the sketch board

`mv.Sketch` drives the sketch page shipped as `molvis/sketch_dist`
(`npm run build:sketch-page`; `npm run build:page` runs it). Its document
methods are `sketch.*` JSON-RPC requests, answered by
`sketch-viewer/src/python/board_rpc.ts`.

- `load_smiles(text)` / `load_molecule(Atomistic | Frame | mapping)` draw a
  molpy structure as a formula: Kekulé bonds, formal charges, hydrogens folded
  into heteroatom labels (`OH⁻`, `N⁺`), and port markers. Bonding descriptors
  (`[<]OCC[>]`) or a frame `ports` block mark the anchor atoms with a dashed
  ring and the descriptor.
- **2D coordinates.** Flat `x`/`y` on the structure (no `z`, or `z` all zero)
  are drawn as given. Otherwise — no coordinates, or a 3D conformer — the page
  lays the molecule out (`MoleculeLayout` in `@molcrafts/molvis-sketch`:
  regular rings, fused/spiro ring systems, 120° zig-zag chains, branches,
  linear `sp` centres, fragments side by side). A 2D coordinate generator in
  molpy would take over without changes here.
- `export_svg(path)` / `export_png(path)` write fitted, selection-free images.

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
not answer within `timeout` (default 5 s); software WebGL in a headless page is
slower, so pass a larger `timeout` there. The first snapshot after
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
