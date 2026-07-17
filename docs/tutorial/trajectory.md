# Trajectories and frames

A **trajectory** is an indexed sequence of frames. A structure answers “where
are the atoms now?”; a trajectory answers that question repeatedly over time.
Most trajectories share topology while coordinates and box dimensions vary.

## A three-frame example

The viewer below receives three concatenated XYZ frames. Use the trajectory
control or the arrow keys to change the active index.

```molvis {format="xyz" controls="view trajectory"}
3
name="water frame 0" Connct="[0,1,0,2]"
O  0.0000  0.0000  0.0000
H  0.9572  0.0000  0.0000
H -0.2390  0.9266  0.0000
3
name="water frame 1" Connct="[0,1,0,2]"
O  0.0000  0.0000  0.0800
H  0.9300  0.0900 -0.0200
H -0.1800  0.9000  0.0800
3
name="water frame 2" Connct="[0,1,0,2]"
O  0.0000  0.0000 -0.0600
H  0.9000 -0.1000  0.0600
H -0.3000  0.8800 -0.0200
```

## What changes when you seek

Seeking changes the active frame index, updates frame-dependent coordinates and
properties, reruns the pipeline, and refreshes visible geometry. It does not
replace the global representation, camera settings, or pipeline definition.

This separation matters when comparing time steps: if frame 10 is spacefill and
frame 11 silently becomes wireframe, visual comparison is misleading. MolVis
therefore treats representation as scene state shared across the trajectory.

## Streaming and large trajectories

Small multi-frame text files can be parsed eagerly. Binary DCD/TRR/XTC and Zarr
sources may expose random-access readers so MolVis loads or decodes the requested
frame without retaining every expanded frame in memory. The timeline contract
stays the same: a frame count, a current index, and a way to seek.

## Playback is repeated seeking

Playback advances indices on a clock. `Space` toggles playback; Left and Right
step one frame. Rendering can skip work when only coordinates changed, while a
topology change requires a fuller scene rebuild.

## Checkpoint

Be able to name which state is per-frame (coordinates/properties) and which is
global (representation/pipeline configuration). The final tutorial page explains
how that combined state affects [export](export.md).
