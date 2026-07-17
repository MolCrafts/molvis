# Video encoding

MolVis separates rendering PNG frames from encoding them. This keeps camera or
trajectory scheduling independent of the FFmpeg process.

## Install the encoder

```bash
python -m pip install "molcrafts-molvis[video]"
```

The resolver first checks for `ffmpeg` on `PATH`, then uses the binary supplied
by `imageio-ffmpeg`.

## Encode PNG byte payloads

```python
from molvis.video import write_video

output = write_video(
    png_frames,
    "trajectory.mp4",
    fps=30,
    codec="libx264",
    crf=18,
    pix_fmt="yuv420p",
)
print(output)
```

`png_frames` may be any iterable of complete PNG byte payloads, including
frames captured with `scene.snapshot()` after your code updates trajectory or
camera state. Frames are streamed into FFmpeg stdin, so the encoder does not
need to retain the entire uncompressed animation in memory.

## Browser-compatible defaults

The defaults use H.264, `yuv420p`, and `+faststart`, which are broadly playable
in browsers and QuickTime. Use `extra_args` for filters such as scaling:

```python
write_video(
    png_frames,
    "preview.mp4",
    fps=24,
    extra_args=["-vf", "scale=1280:720"],
)
```

Invalid PNG data or encoder settings raise `RuntimeError` with FFmpeg stderr.
If neither system nor bundled FFmpeg is available, MolVis raises
`FfmpegNotFoundError` with installation guidance.
