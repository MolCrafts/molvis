# Camera and viewport

The second concept is the **camera**. The molecule lives in a 3-D scene, while
the browser shows a 2-D canvas. The camera defines the position, target,
projection, and clipping range used to make that image.

## Orbit changes the view, not the molecule

MolVis uses an orbit camera for ordinary viewing. It points at a target near the
structure and moves on a sphere around that target.

| Action | Default input | What changes |
|---|---|---|
| Orbit | Left-drag | Camera direction around the target |
| Pan | Middle-drag or Shift + left-drag | Camera target |
| Zoom | Mouse wheel or trackpad scroll | Camera distance / orthographic scale |
| Fit | `F` | Target and distance calculated from current visible bounds |

None of these operations changes atomic coordinates. If you export the
structure after orbiting, its coordinates are identical. A screenshot changes
because screenshots capture the camera view.

## Why `F` matters

Fit is more than a convenient zoom shortcut. MolVis computes bounds from the
currently rendered atoms (including their radii), chooses a stable view, and
sets near/far clipping planes large enough for the structure. Use `F` after:

- loading a structure with a very different size;
- filtering most atoms through the pipeline;
- switching to a representation with much larger radii;
- deciding that the periodic box should participate in framing.

## Perspective and depth

In perspective projection, distant atoms appear smaller. Lighting, overlap,
and motion provide additional depth cues. This is why a slow rotation is useful
in a read-only documentation example: it reveals topology that a single static
angle can hide.

## Checkpoint

If an atom appears in a different screen position after orbiting, ask whether
its **world coordinate** changed or only its **projection** changed. In View
mode, only the projection changed.

Next, keep the frame and camera conceptually fixed while changing only the
[molecular representation](representations.md).
